
import { GoogleGenAI, LiveServerMessage } from '@google/genai';
import { createPcmBlob, decodeAudioData, base64ToUint8Array } from './audioUtils';

export class GeminiLiveService {
  private ai: GoogleGenAI | null = null;
  private sessionPromise: Promise<any> | null = null;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private onLogCallback: ((text: string, isModel: boolean, isTurnComplete?: boolean) => void) | null = null;
  private onDisconnectCallback: (() => void) | null = null;
  private onVolumeCallback: ((volume: number) => void) | null = null;
  
  // Video streaming
  private videoInterval: number | null = null;

  constructor() {}

  public setOnLog(callback: (text: string, isModel: boolean, isTurnComplete?: boolean) => void) {
    this.onLogCallback = callback;
  }

  public setOnDisconnect(callback: () => void) {
    this.onDisconnectCallback = callback;
  }

  public setOnVolume(callback: (volume: number) => void) {
    this.onVolumeCallback = callback;
  }

  public async connect(
    stream: MediaStream, 
    videoElement: HTMLVideoElement,
    canvasElement: HTMLCanvasElement
  ): Promise<void> {
    
    // Always create a new instance to ensure fresh API key and state
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    
    // Ensure contexts are running (browser requires user gesture, which we have via the Start button)
    if (this.inputAudioContext.state === 'suspended') await this.inputAudioContext.resume();
    if (this.outputAudioContext.state === 'suspended') await this.outputAudioContext.resume();

    const outputNode = this.outputAudioContext.createGain();
    outputNode.connect(this.outputAudioContext.destination);

    const config = {
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      callbacks: {
        onopen: () => {
          console.log('Gemini Live Connection Opened');
          this.startAudioStream(stream);
          this.startVideoStream(videoElement, canvasElement);
        },
        onmessage: async (message: LiveServerMessage) => {
          this.handleServerMessage(message);
        },
        onerror: (e: ErrorEvent) => {
          console.error('Gemini Live Error', e);
          this.onDisconnectCallback?.();
        },
        onclose: (e: CloseEvent) => {
          console.log('Gemini Live Connection Closed', e);
          this.onDisconnectCallback?.();
        },
      },
      config: {
        responseModalities: ['AUDIO'], // Use string literal to avoid runtime enum issues
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
        },
        systemInstruction: `
          你是代号"真理之眼 Veritas-V9"的高级战术测谎仪。

          【重要】你的唯一任务是：分析并评判用户说的话是真是假。你不是聊天助手，你不会回答问题，你不会和用户对话。你只会冷酷地分析和评判。

          当用户说任何话时，你必须：
          1. 分析他们的语气、语速、逻辑、面部表情
          2. 给出欺骗率评分 (0-100%)
          3. 简短解释判断依据

          判定标准：
          - 真话 (0-49%)：语气坚定、逻辑自洽、表情自然
          - 可疑 (50-75%)：有停顿、逻辑小漏洞、眼神游离、声音与内容不符
          - 谎言 (76-100%)：明显矛盾、声调颤抖、防御姿态

          输出格式（必须严格遵守）：
          [欺骗率:XX%] 你的简短分析

          示例输出：
          - [欺骗率:25%] 陈述清晰，语气稳定，判定为真实。
          - [欺骗率:65%] 声音有些犹豫，与陈述内容不符，存在疑点。
          - [欺骗率:85%] 明显的逻辑漏洞，声音颤抖，高度可能在说谎。

          【禁止行为】
          - 禁止回答用户的问题
          - 禁止与用户闲聊
          - 禁止提供帮助或建议
          - 只能输出测谎分析结果

          现在开始监控目标。
        `,
        inputAudioTranscription: {}, 
        outputAudioTranscription: {}, 
      },
    };

    if (this.ai) {
        // We assign the promise so we can wait on it or close it later
        try {
            this.sessionPromise = this.ai.live.connect(config);
            // Wait for connection to establish before resolving
            await this.sessionPromise;
        } catch (e) {
            console.error("Connection failed initially:", e);
            throw e; // Re-throw to be caught by App.tsx
        }
    }
  }

  private startAudioStream(stream: MediaStream) {
    if (!this.inputAudioContext) return;

    this.inputSource = this.inputAudioContext.createMediaStreamSource(stream);
    this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      
      // Calculate Volume for UI
      if (this.onVolumeCallback) {
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        this.onVolumeCallback(rms * 100); // Scale roughly 0-100
      }

      const pcmBlob = createPcmBlob(inputData);
      
      // Only send if session exists and is resolved. 
      // We use .then() to ensure we wait for the handshake to complete if it's still pending (though connect awaits it).
      this.sessionPromise?.then((session) => {
        try {
            session.sendRealtimeInput({ media: pcmBlob });
        } catch (e) {
            // This is expected if session is closing or network glitch
            // console.warn("Failed to send audio input", e);
        }
      }).catch(e => {
        // Swallow errors if session promise failed (e.g. disconnect happened)
      });
    };

    this.inputSource.connect(this.processor);
    this.processor.connect(this.inputAudioContext.destination);
  }

  private startVideoStream(videoEl: HTMLVideoElement, canvasEl: HTMLCanvasElement) {
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    // Send frames at ~1 fps to save bandwidth but keep context
    this.videoInterval = window.setInterval(() => {
        if (!videoEl.videoWidth || !videoEl.videoHeight) return;
        
        canvasEl.width = videoEl.videoWidth / 2; // Downscale slightly for perf
        canvasEl.height = videoEl.videoHeight / 2;
        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

        const base64Data = canvasEl.toDataURL('image/jpeg', 0.6).split(',')[1];
        
        this.sessionPromise?.then((session) => {
            try {
                session.sendRealtimeInput({
                    media: { data: base64Data, mimeType: 'image/jpeg' }
                });
            } catch (e) {
                 // console.warn("Failed to send video input", e);
            }
        }).catch(() => {});

    }, 1000); 
  }

  private async handleServerMessage(message: LiveServerMessage) {
    const isTurnComplete = message.serverContent?.turnComplete || false;

    // 1. Handle User Input Transcription (So user knows they are heard)
    if (message.serverContent?.inputTranscription && this.onLogCallback) {
        this.onLogCallback(message.serverContent.inputTranscription.text, false, isTurnComplete);
    }

    // 2. Handle Model Output Transcription (Analysis)
    if (message.serverContent?.outputTranscription && this.onLogCallback) {
        this.onLogCallback(message.serverContent.outputTranscription.text, true, isTurnComplete);
    }
    
    // 3. Handle Audio Output
    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    
    if (base64Audio && this.outputAudioContext) {
      if (this.outputAudioContext.state === 'suspended') await this.outputAudioContext.resume();

      this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
      
      const audioBuffer = await decodeAudioData(
        base64ToUint8Array(base64Audio),
        this.outputAudioContext,
        24000,
        1
      );

      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      const outputNode = this.outputAudioContext.createGain();
      outputNode.connect(this.outputAudioContext.destination);
      source.connect(outputNode);
      
      source.addEventListener('ended', () => {
        this.sources.delete(source);
      });

      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;
      this.sources.add(source);
    }

    // Handle Interruption
    if (message.serverContent?.interrupted) {
      this.sources.forEach(source => source.stop());
      this.sources.clear();
      this.nextStartTime = 0;
    }
  }

  public async disconnect() {
    // 1. Close session if it exists
    if (this.sessionPromise) {
        try {
            // We await the promise to get the session object. 
            // If the connection failed initially, this await will throw, which we catch.
            const session = await this.sessionPromise;
            session.close();
        } catch (e) {
            console.warn("Session close error (or session never started):", e);
        }
    }

    // 2. Clean up audio/video resources
    this.processor?.disconnect();
    this.inputSource?.disconnect();
    this.inputAudioContext?.close();
    this.outputAudioContext?.close();
    
    if (this.videoInterval) {
        clearInterval(this.videoInterval);
        this.videoInterval = null;
    }

    // 3. Reset state
    this.sessionPromise = null;
    this.inputAudioContext = null;
    this.outputAudioContext = null;
    this.ai = null;
  }
}

export const geminiLive = new GeminiLiveService();
