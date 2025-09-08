// Audio Worklet Processor for real-time audio capture with smart chunking
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkCount = 0;
    this.lastLogTime = 0;
    
    // Audio accumulation for chunking
    this.audioBuffer = [];
    this.lastAudioTime = Date.now(); // Initialize to now to prevent immediate silence detection
    this.silenceThreshold = 0.01; // Increased threshold for better silence detection
    this.silenceTimeoutMs = 800; // 800ms silence triggers chunk
    this.maxChunkSamples = 16000 * 10; // 10 seconds max chunk length
    this.sampleRate = 16000; // Assume 16kHz sample rate
    this.minChunkSamples = 16000 * 0.5; // Minimum 0.5 seconds before considering silence
    
    // Log processor initialization
    this.port.postMessage({
      type: 'log',
      message: 'AudioCaptureProcessor initialized with smart chunking (800ms silence, 10s max)'
    });
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const currentTime = Date.now();
    
    // Log every 5 seconds to show we're processing
    if (currentTime - this.lastLogTime > 5000) {
      this.port.postMessage({
        type: 'log', 
        message: `AudioWorklet processing - buffer size: ${this.audioBuffer.length} samples`
      });
      this.lastLogTime = currentTime;
    }
    
    if (input && input.length > 0) {
      const inputChannel = input[0];
      
      if (inputChannel && inputChannel.length > 0) {
        // Add samples to our buffer
        for (let i = 0; i < inputChannel.length; i++) {
          this.audioBuffer.push(inputChannel[i]);
        }
        
        // Check if there's actual audio data in this frame
        const hasAudio = inputChannel.some(sample => Math.abs(sample) > this.silenceThreshold);
        
        if (hasAudio) {
          this.lastAudioTime = currentTime;
        }
        
        // Check if we should send a chunk
        const silenceDuration = currentTime - this.lastAudioTime;
        const shouldSendChunk = 
          (silenceDuration >= this.silenceTimeoutMs && this.audioBuffer.length >= this.minChunkSamples) || // Silence detected AND minimum length
          (this.audioBuffer.length >= this.maxChunkSamples); // Max length reached
        
        if (shouldSendChunk) {
          this.chunkCount++;
          
          // Create a copy of the buffer to send
          const chunkData = new Float32Array(this.audioBuffer);
          
          this.port.postMessage({
            type: 'log',
            message: `About to send chunk ${this.chunkCount}: ${chunkData.length} samples, ${((chunkData.length / this.sampleRate) * 1000).toFixed(0)}ms, trigger: ${silenceDuration >= this.silenceTimeoutMs ? 'silence' : 'maxLength'}`
          });
          
          // Send audio chunk to main thread
          this.port.postMessage({
            type: 'audio-chunk',
            data: chunkData,
            chunkNumber: this.chunkCount,
            length: chunkData.length,
            durationMs: (chunkData.length / this.sampleRate) * 1000,
            triggerReason: silenceDuration >= this.silenceTimeoutMs ? 'silence' : 'maxLength'
          });
          
          // Clear the buffer for next chunk
          this.audioBuffer = [];
          
          this.port.postMessage({
            type: 'log',
            message: `Sent chunk ${this.chunkCount} successfully`
          });
        }
      }
    }
    
    return true; // Keep processor alive
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);