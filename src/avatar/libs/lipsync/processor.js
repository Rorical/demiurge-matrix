class LipsyncProcessor extends AudioWorkletProcessor {
    static BUFFER_SIZE = 128
    constructor() {
        super()
        this.offset = 0
    }
    process(inputList, _outputList, _parameters) {
        this.offset += inputList[0][0].length
        if (this.offset >= LipsyncProcessor.BUFFER_SIZE - 1) {
            this.flush()
        }
        return true
    }
    flush() {
        this.offset = 0
        this.port.postMessage(0)
    }
}
registerProcessor('processor', LipsyncProcessor)
