// Audio Worklet Processor for real-time audio capture
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkCount = 0;
    this.lastLogTime = 0;
    
    // Log processor initialization
    this.port.postMessage({
      type: 'log',
      message: 'AudioCaptureProcessor initialized'
    });
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const currentTime = Date.now();
    
    // Log every 5 seconds to show we're processing
    if (currentTime - this.lastLogTime > 5000) {
      this.port.postMessage({
        type: 'log', 
        message: `AudioWorklet process() called - inputs: ${inputs.length}, input channels: ${input ? input.length : 0}`
      });
      this.lastLogTime = currentTime;
    }
    
    if (input && input.length > 0) {
      const inputChannel = input[0];
      
      if (inputChannel && inputChannel.length > 0) {
        this.chunkCount++;
        
        // Check if there's actual audio data
        const hasAudio = inputChannel.some(sample => Math.abs(sample) > 0.001);
        
        // Send audio data to main thread
        this.port.postMessage({
          type: 'audio-data',
          data: inputChannel,
          chunkNumber: this.chunkCount,
          hasAudio: hasAudio,
          length: inputChannel.length
        });
      }
    }
    
    return true; // Keep processor alive
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);