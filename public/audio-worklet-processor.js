// Audio Worklet Processor for real-time audio capture
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkCount = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    
    if (input && input.length > 0) {
      const inputChannel = input[0];
      
      if (inputChannel && inputChannel.length > 0) {
        this.chunkCount++;
        
        // Send audio data to main thread
        this.port.postMessage({
          type: 'audio-data',
          data: inputChannel,
          chunkNumber: this.chunkCount
        });
      }
    }
    
    return true; // Keep processor alive
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);