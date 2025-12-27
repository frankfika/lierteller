
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { LineChart, Line, YAxis, ResponsiveContainer, XAxis, Tooltip, ReferenceLine } from 'recharts';
import { ShieldAlert, Activity, Mic, Power, Cpu, ScanLine, ShieldCheck, AlertTriangle, BarChart3, Clock, MessageSquare, TrendingUp, ChevronUp, X } from 'lucide-react';
import { geminiLive } from './services/geminiLiveService';
import { LogEntry, SessionStatus, BiometricData } from './types';
import { Panel, Button } from './components/HolographicComponents';

const MAX_LOGS = 100;
const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_ATTEMPTS = 3;

const App: React.FC = () => {
  const [status, setStatus] = useState<SessionStatus>(SessionStatus.IDLE);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [biometrics, setBiometrics] = useState<BiometricData>({ heartRate: 75, stressLevel: 15, pupilDilation: 3.2 });
  const [lieProbability, setLieProbability] = useState<number>(0);
  const [history, setHistory] = useState<{time: number, value: number}[]>([]);
  const [lastAnalysis, setLastAnalysis] = useState<string>('系统待机...');
  const [inputVolume, setInputVolume] = useState<number>(0);
  const [showPrivacyNotice, setShowPrivacyNotice] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [mobileLogsOpen, setMobileLogsOpen] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const isDanger = lieProbability > 75;
  const isSuspicious = lieProbability >= 50 && lieProbability <= 75;
  const isTruth = lieProbability < 50 && status === SessionStatus.ACTIVE && lastAnalysis !== '系统待机...';

  const sessionStats = useMemo(() => {
    const userMessages = logs.filter(l => l.type === 'neutral').length;
    const aiMessages = logs.filter(l => l.type !== 'neutral').length;
    const avgProbability = history.length > 0
      ? Math.round(history.reduce((sum, h) => sum + h.value, 0) / history.length)
      : 0;
    let duration = '00:00';
    if (sessionStartTime && status === SessionStatus.ACTIVE) {
      const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
      const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const secs = (elapsed % 60).toString().padStart(2, '0');
      duration = `${mins}:${secs}`;
    }
    return { userMessages, aiMessages, avgProbability, duration };
  }, [logs, history, sessionStartTime, status]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    if (status !== SessionStatus.ACTIVE || !sessionStartTime) return;
    const timer = setInterval(() => setSessionStartTime(prev => prev), 1000);
    return () => clearInterval(timer);
  }, [status, sessionStartTime]);

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (status !== SessionStatus.ACTIVE) return;
    const interval = setInterval(() => {
      setBiometrics(prev => {
        const stressFactor = lieProbability / 100;
        return {
          heartRate: Math.max(60, Math.min(180, prev.heartRate + (Math.random() - 0.5) * 5 + (stressFactor * 5))),
          stressLevel: Math.max(0, Math.min(100, (stressFactor * 80) + (Math.random() * 20))),
          pupilDilation: Math.max(2, Math.min(8, prev.pupilDilation + (Math.random() - 0.5) * 0.5)),
        };
      });
      setHistory(prev => {
        const newHistory = [...prev, { time: Date.now(), value: lieProbability }];
        if (newHistory.length > 50) newHistory.shift();
        return newHistory;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status, lieProbability]);

  const handleLog = useCallback((text: string, isModel: boolean, isTurnComplete: boolean = false) => {
    if (!text) return;

    setLogs(prev => {
      const lastLog = prev[prev.length - 1];
      const lastIsModelLog = lastLog && lastLog.type !== 'neutral';
      let updatedLogs: LogEntry[];

      // 如果是同一个说话者且不是新的分析（不包含[欺骗率），则合并消息
      if (lastLog && (lastIsModelLog === isModel) && !text.includes('[')) {
        updatedLogs = [...prev];
        updatedLogs[updatedLogs.length - 1] = { ...lastLog, message: lastLog.message + text };
      } else {
        // 新消息
        const type: 'neutral' | 'truth' | 'deception' | 'system' = isModel ? 'system' : 'neutral';
        updatedLogs = [...prev, {
          id: Math.random().toString(36).substr(2, 9),
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          message: text,
          type
        }];
      }

      // 限制日志数量
      while (updatedLogs.length > MAX_LOGS) updatedLogs.shift();
      return updatedLogs;
    });
  }, []);

  const handleDisconnect = useCallback(() => {
    setStatus(SessionStatus.ERROR);
    setSessionStartTime(null);
    cleanupSession();
    // 添加断开连接日志
    setLogs(prev => [...prev, {
      id: `sys-disc-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      message: '连接已断开 / CONNECTION LOST',
      type: 'deception'
    }]);
  }, []);

  const parseDeceptionRate = useCallback((text: string): number | null => {
    const patterns = [
      /\[\s*欺骗率\s*[:：]\s*(\d+)\s*%\s*\]/,
      /欺骗率\s*[:：]?\s*(\d+)\s*%/,
      /deception\s*[:：]?\s*(\d+)\s*%/i,
      /(\d+)\s*%\s*欺骗/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const value = parseInt(match[1], 10);
        if (value >= 0 && value <= 100) return value;
      }
    }
    return null;
  }, []);

  useEffect(() => {
    if (logs.length === 0) return;
    const lastLog = logs[logs.length - 1];
    if (lastLog.type !== 'neutral') {
      const prob = parseDeceptionRate(lastLog.message);
      if (prob !== null) {
        setLieProbability(prob);
        let newType: 'neutral' | 'truth' | 'deception' | 'system' = 'system';
        if (prob > 75) newType = 'deception';
        else if (prob < 50) newType = 'truth';
        const cleanMsg = lastLog.message
          .replace(/\[\s*欺骗率\s*[:：]\s*\d+\s*%\s*\]/g, '')
          .replace(/欺骗率\s*[:：]?\s*\d+\s*%/g, '')
          .trim();
        setLastAnalysis(cleanMsg || '数据分析中...');
        if (lastLog.type !== newType) {
          setLogs(prev => {
            const updated = [...prev];
            updated[updated.length - 1].type = newType;
            return updated;
          });
        }
      }
    }
  }, [logs, parseDeceptionRate]);

  const cleanupSession = async () => {
    try { await geminiLive.disconnect(); } catch {}
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setLieProbability(0);
    setBiometrics({ heartRate: 75, stressLevel: 15, pupilDilation: 3.2 });
    setInputVolume(0);
  };

  const startSessionInternal = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play();
    }
    geminiLive.setOnLog(handleLog);
    geminiLive.setOnDisconnect(handleDisconnect);
    geminiLive.setOnVolume(setInputVolume);
    if (videoRef.current && canvasRef.current) {
      await geminiLive.connect(stream, videoRef.current, canvasRef.current);
    }
    setStatus(SessionStatus.ACTIVE);
    setSessionStartTime(Date.now());

    // 添加系统初始化日志
    setLogs(prev => [...prev, {
      id: `sys-init-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      message: '系统初始化完成，神经链路已建立。开始监控...',
      type: 'system'
    }]);
  };

  const startSession = async () => {
    if (status === SessionStatus.CONNECTING) return;
    if (!showPrivacyNotice && status === SessionStatus.IDLE) {
      setShowPrivacyNotice(true);
      return;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setReconnectAttempts(0);
    await cleanupSession();
    try {
      setStatus(SessionStatus.CONNECTING);
      setLogs([]);
      setLieProbability(0);
      setLastAnalysis('系统待机...');
      setHistory([]);
      await startSessionInternal();
    } catch (err) {
      await cleanupSession();
      setStatus(SessionStatus.ERROR);
    }
  };

  const confirmPrivacyAndStart = () => {
    setShowPrivacyNotice(false);
    startSession();
  };

  const endSession = async () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setReconnectAttempts(0);
    await cleanupSession();
    setStatus(SessionStatus.IDLE);
    setLastAnalysis('系统待机...');
    setSessionStartTime(null);
  };

  const getThemeColor = () => {
    if (isDanger) return '#ff003c';
    if (isSuspicious) return '#ffaa00';
    return '#00f3ff';
  };

  const getVerdictText = () => {
    if (isDanger) return '谎言确认';
    if (isSuspicious) return '高度可疑';
    if (isTruth) return '诚实';
    return '待机';
  };

  return (
    <div className="h-screen w-full bg-[#02040a] text-[#00f3ff] overflow-hidden relative crt-flicker" style={{ color: getThemeColor() }}>
      <div className="scanlines"></div>
      {/* 背景氛围光 */}
      <div className={`absolute inset-0 pointer-events-none opacity-20 transition-all duration-1000`} style={{ background: `radial-gradient(circle at center, ${getThemeColor()}, transparent 70%)` }}></div>

      {/* 隐私弹窗 */}
      {showPrivacyNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
          <div className="border-2 border-[#00f3ff] bg-[#02040a] p-4 md:p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-4">
              <ShieldAlert className="w-6 h-6 text-[#ffaa00]" />
              <h2 className="text-lg font-bold text-[#00f3ff]">隐私声明</h2>
            </div>
            <p className="text-sm text-gray-300 mb-2">本应用将通过摄像头和麦克风采集数据进行分析。</p>
            <p className="text-xs text-[#ffaa00] mb-4">⚠️ 这是演示应用，结果仅供娱乐</p>
            <div className="flex gap-2">
              <button onClick={() => setShowPrivacyNotice(false)} className="flex-1 py-3 border border-[#ff003c] text-[#ff003c] font-bold">取消</button>
              <button onClick={confirmPrivacyAndStart} className="flex-1 py-3 border border-[#00f3ff] text-[#00f3ff] font-bold">继续</button>
            </div>
          </div>
        </div>
      )}

      {/* 移动端日志抽屉 */}
      {mobileLogsOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/95 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#00f3ff]/30">
            <h3 className="text-[#00f3ff] font-bold tracking-widest">实时日志 / LIVE_LOG</h3>
            <button onClick={() => setMobileLogsOpen(false)} className="p-2">
              <X size={20} className="text-[#00f3ff]" />
            </button>
          </div>
          {/* 移动端趋势图 */}
          {history.length > 0 && (
            <div className="flex-none px-4 py-3 border-b border-[#00f3ff]/20">
              <div className="text-xs opacity-60 mb-2 tracking-wider">欺骗率趋势 / TREND</div>
              <div className="h-[80px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <YAxis domain={[0, 100]} hide />
                    <XAxis hide />
                    <ReferenceLine y={50} stroke="#ffaa00" strokeDasharray="3 3" opacity={0.5} />
                    <ReferenceLine y={75} stroke="#ff003c" strokeDasharray="3 3" opacity={0.5} />
                    <Line type="monotone" dataKey="value" stroke={getThemeColor()} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-between text-[10px] opacity-40 font-mono">
                <span>0%</span><span>50%</span><span>75%</span><span>100%</span>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {logs.map((log) => (
              <div key={log.id} className={`p-2 border-l-2 text-sm ${
                log.type === 'deception' ? 'border-[#ff003c] bg-[#ff003c]/10 text-[#ff003c]' :
                log.type === 'truth' ? 'border-[#00f3ff] bg-[#00f3ff]/10 text-[#00f3ff]' :
                log.type === 'system' ? 'border-[#ffaa00] text-[#ffaa00]' :
                'border-gray-500 text-gray-300'
              }`}>
                <span className="opacity-50 text-xs">[{log.timestamp}]</span>
                <div className="mt-1">{log.message}</div>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

      {/* ===== 主布局 ===== */}
      <div className="h-full flex flex-col">

        {/* 顶栏 */}
        <header className="flex-none flex justify-between items-center px-3 md:px-4 py-2 md:py-3 border-b border-current/30 z-10">
          <div className="flex items-center gap-2 md:gap-4">
            <div className={`relative ${isDanger ? 'animate-pulse' : ''}`}>
              {isDanger ? <ShieldAlert className="w-7 h-7 md:w-10 md:h-10" /> :
               isSuspicious ? <AlertTriangle className="w-7 h-7 md:w-10 md:h-10" /> :
               <ShieldCheck className="w-7 h-7 md:w-10 md:h-10" />}
            </div>
            <div>
              <h1 className="text-lg md:text-3xl font-chinese font-bold tracking-tight" style={{ textShadow: `0 0 15px ${getThemeColor()}` }}>
                神经测谎仪 <span className="text-xs md:text-sm align-top opacity-70 font-display">2077</span>
              </h1>
              <p className="text-[8px] md:text-[10px] tracking-[0.3em] md:tracking-[0.5em] opacity-60 font-display">VERITAS_V9_PROTOCOL</p>
            </div>
          </div>
          <div className="text-right">
            <div className="hidden md:block text-xs opacity-50 mb-1">系统状态 / SYSTEM STATUS</div>
            <div className="flex items-center justify-end gap-2 text-xs md:text-base font-display font-bold">
              {status === SessionStatus.ACTIVE && <span className="w-2 h-2 rounded-full bg-current animate-pulse"></span>}
              <span>
                {status === SessionStatus.IDLE ? 'STANDBY' :
                 status === SessionStatus.CONNECTING ? 'CONNECTING...' :
                 status === SessionStatus.ACTIVE ? 'MONITORING' : 'DISCONNECTED'}
              </span>
            </div>
          </div>
        </header>

        {/* 主内容区 */}
        <main className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-12 gap-2 md:gap-3 p-2 md:p-3 overflow-hidden">

          {/* 左侧面板 - 桌面端 */}
          <div className="hidden md:flex md:col-span-3 flex-col gap-3 min-h-0">
            <Panel title="生物遥测 / BIO_METRICS" className="flex-none" alert={isDanger}>
              <div className="space-y-4 pt-2">
                <div>
                  <div className="flex justify-between text-xs opacity-70 mb-1">
                    <span className="flex items-center gap-2"><Activity size={14}/> 心率 / BPM</span>
                    <span className={biometrics.heartRate > 120 ? 'text-[#ff003c]' : biometrics.heartRate > 90 ? 'text-[#ffaa00]' : ''}>
                      {biometrics.heartRate > 120 ? '危急' : biometrics.heartRate > 90 ? '升高' : '正常'}
                    </span>
                  </div>
                  <div className="text-2xl font-display font-bold tabular-nums">{Math.round(biometrics.heartRate)}</div>
                  <div className="h-1 bg-gray-900 mt-2 overflow-hidden">
                    <div className="h-full transition-all duration-300" style={{ width: `${(biometrics.heartRate / 200) * 100}%`, backgroundColor: getThemeColor() }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs opacity-70 mb-1">
                    <span className="flex items-center gap-2"><Cpu size={14}/> 皮质醇 / STRESS</span>
                  </div>
                  <div className="text-2xl font-display font-bold tabular-nums">{Math.round(biometrics.stressLevel)}%</div>
                  <div className="h-1 bg-gray-900 mt-2 overflow-hidden">
                    <div className="h-full transition-all duration-300" style={{ width: `${biometrics.stressLevel}%`, backgroundColor: biometrics.stressLevel > 60 ? '#ff003c' : getThemeColor() }}></div>
                  </div>
                </div>
              </div>
            </Panel>

            {status === SessionStatus.ACTIVE && (
              <Panel title="会话统计 / SESSION_STATS" className="flex-none" alert={isDanger}>
                <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Clock size={12} className="opacity-50" />
                    <span className="opacity-70">时长:</span>
                    <span className="font-display font-bold">{sessionStats.duration}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <TrendingUp size={12} className="opacity-50" />
                    <span className="opacity-70">平均:</span>
                    <span className="font-display font-bold">{sessionStats.avgProbability}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MessageSquare size={12} className="opacity-50" />
                    <span className="opacity-70">发言:</span>
                    <span className="font-display font-bold">{sessionStats.userMessages}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <BarChart3 size={12} className="opacity-50" />
                    <span className="opacity-70">分析:</span>
                    <span className="font-display font-bold">{sessionStats.aiMessages}</span>
                  </div>
                </div>
              </Panel>
            )}

            <Panel title="实时日志 / LIVE_LOG" className="flex-1 min-h-0 flex flex-col" alert={isDanger}>
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 font-mono text-xs custom-scrollbar">
                {logs.length === 0 && <div className="text-center opacity-30 mt-10">等待数据流...</div>}
                {logs.map((log) => (
                  <div key={log.id} className={`p-2 border-l-2 text-xs leading-relaxed break-words ${
                    log.type === 'deception' ? 'border-[#ff003c] bg-[#ff003c]/10 text-[#ff003c]' :
                    log.type === 'truth' ? 'border-[#00f3ff] bg-[#00f3ff]/10 text-[#00f3ff]' :
                    log.type === 'system' ? 'border-[#ffaa00] text-[#ffaa00]' :
                    'border-current opacity-80'
                  }`} style={{ borderColor: log.type === 'neutral' ? getThemeColor() : undefined }}>
                    <span className="opacity-50 select-none">[{log.timestamp}] {log.type === 'neutral' ? '受审者' : 'V9_系统'}:</span><br/>
                    {log.message}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </Panel>
          </div>

          {/* 中央视频区 */}
          <div className="flex-1 md:col-span-6 flex flex-col gap-2 md:gap-3 min-h-0">
            <div className={`relative flex-1 min-h-[250px] md:min-h-0 bg-black border-2 overflow-hidden transition-all duration-500 ${
              status === SessionStatus.ERROR ? 'border-red-600' :
              isDanger ? 'border-[#ff003c] shadow-[0_0_30px_rgba(255,0,60,0.4)]' :
              isSuspicious ? 'border-[#ffaa00] shadow-[0_0_25px_rgba(255,170,0,0.3)]' :
              'border-[#00f3ff] shadow-[0_0_20px_rgba(0,243,255,0.3)]'
            }`}>
              <video ref={videoRef} muted playsInline className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${status === SessionStatus.ACTIVE ? 'opacity-80' : 'opacity-20'} mix-blend-screen grayscale-[30%] contrast-125`} />
              <canvas ref={canvasRef} className="hidden" />

              {/* 扫描效果和面部追踪框 */}
              {status === SessionStatus.ACTIVE && (
                <div className="absolute inset-0 pointer-events-none">
                  {/* 网格背景 */}
                  <div className="absolute inset-0 bg-[linear-gradient(rgba(0,243,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,243,255,0.03)_1px,transparent_1px)] bg-[size:20px_20px]"></div>

                  {/* 面部追踪框 */}
                  <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[55%] md:w-[50%] h-[65%] md:h-[70%] transition-all duration-300 border border-opacity-60 ${
                    isDanger ? 'border-[#ff003c]' : isSuspicious ? 'border-[#ffaa00]' : 'border-[#00f3ff]'
                  }`}>
                    {/* 四角标记 */}
                    <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-current"></div>
                    <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-current"></div>
                    <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-current"></div>
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-current"></div>
                    {/* 目标锁定标签 */}
                    <div className={`absolute -bottom-6 left-0 text-[10px] px-1 font-bold font-display ${
                      isDanger ? 'bg-[#ff003c] text-black' :
                      isSuspicious ? 'bg-[#ffaa00] text-black' :
                      'bg-[#00f3ff] text-black'
                    }`}>TARGET_LOCKED</div>
                  </div>

                  {/* 危险时的红色闪烁 */}
                  {isDanger && <div className="absolute inset-0 glitch-effect bg-red-900/10 mix-blend-overlay"></div>}
                </div>
              )}

              {/* 待机/连接/错误状态 */}
              {status !== SessionStatus.ACTIVE && (
                <div className="absolute inset-0 flex items-center justify-center flex-col bg-black/60 backdrop-blur-sm">
                  {status === SessionStatus.ERROR ? (
                    <>
                      <ShieldAlert className="w-20 h-20 md:w-24 md:h-24 text-red-500 mb-4 animate-pulse" />
                      <p className="tracking-[0.3em] text-red-500 font-bold font-display">CONNECTION LOST</p>
                      <p className="text-xs text-red-400 mt-2 opacity-70">PLEASE RE-INITIALIZE SYSTEM</p>
                    </>
                  ) : status === SessionStatus.CONNECTING ? (
                    <>
                      <ScanLine className="w-20 h-20 md:w-24 md:h-24 animate-spin mb-4" strokeWidth={1} />
                      <p className="tracking-[0.3em] text-sm animate-pulse font-display">ESTABLISHING LINK...</p>
                    </>
                  ) : (
                    <>
                      <ScanLine className="w-20 h-20 md:w-24 md:h-24 animate-pulse mb-4" strokeWidth={1} />
                      <p className="tracking-[0.3em] text-sm animate-pulse font-display">AWAITING INPUT STREAM</p>
                    </>
                  )}
                </div>
              )}

              {/* 移动端: 悬浮欺骗率 */}
              {status === SessionStatus.ACTIVE && (
                <div className="md:hidden absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/90 to-transparent p-4 pt-16">
                  {/* 生物数据简要 */}
                  <div className="flex justify-between mb-3 text-[10px] opacity-70">
                    <span className="flex items-center gap-1"><Activity size={10} /> BPM: {Math.round(biometrics.heartRate)}</span>
                    <span className="flex items-center gap-1"><Cpu size={10} /> 压力: {Math.round(biometrics.stressLevel)}%</span>
                    <span className="flex items-center gap-1"><Clock size={10} /> {sessionStats.duration}</span>
                  </div>

                  <div className="flex items-end justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className={`text-base font-chinese font-black tracking-wider ${isDanger ? 'animate-pulse text-[#ff003c]' : isSuspicious ? 'text-[#ffaa00]' : 'text-[#00f3ff]'}`}>
                        {isDanger ? '【谎言确认】' : isSuspicious ? '【高度可疑】' : isTruth ? '【诚实】' : '【分析中】'}
                      </div>
                      <div className="text-xs opacity-70 mt-1 line-clamp-2 font-chinese leading-relaxed">{lastAnalysis}</div>
                    </div>
                    <div className={`text-5xl font-display font-black tracking-tighter ${isDanger ? 'glitch-effect' : ''}`}
                         style={{ color: getThemeColor(), textShadow: `0 0 25px ${getThemeColor()}, 0 0 50px ${getThemeColor()}40` }}>
                      {lieProbability}<span className="text-xl">%</span>
                    </div>
                  </div>
                  {/* 进度条 */}
                  <div className="w-full h-2 bg-black/50 mt-3 border border-current/20 overflow-hidden">
                    <div className="h-full transition-all duration-500"
                         style={{ width: `${lieProbability}%`, background: `linear-gradient(90deg, transparent, ${getThemeColor()})`, boxShadow: `0 0 10px ${getThemeColor()}` }}></div>
                  </div>
                  <div className="flex justify-between text-[8px] opacity-40 mt-1 font-mono">
                    <span>0</span><span>50</span><span>75</span><span>100</span>
                  </div>
                  {/* 音量条 */}
                  <div className="flex items-center gap-2 mt-2">
                    <Mic size={12} className="opacity-50" />
                    <div className="flex-1 h-1.5 bg-black/50 rounded overflow-hidden">
                      <div className="h-full transition-all duration-75" style={{ width: `${Math.min(100, inputVolume * 2)}%`, backgroundColor: getThemeColor() }}></div>
                    </div>
                    <span className="text-[10px] font-mono opacity-50 tabular-nums">{Math.min(100, Math.round(inputVolume * 2))}%</span>
                  </div>
                </div>
              )}
            </div>

            {/* 按钮行 */}
            <div className="flex-none flex gap-2">
              {/* 移动端日志按钮 */}
              {status === SessionStatus.ACTIVE && (
                <button onClick={() => setMobileLogsOpen(true)}
                        className="md:hidden px-4 py-3 border border-current/50 bg-black/70 flex items-center gap-2 text-xs font-display tracking-wider"
                        style={{ borderColor: getThemeColor(), color: getThemeColor() }}>
                  <MessageSquare size={14} />
                  <span>日志</span>
                  {logs.length > 0 && (
                    <span className="bg-current text-black px-1.5 py-0.5 text-[10px] font-bold">{logs.length}</span>
                  )}
                </button>
              )}

              {status === SessionStatus.ACTIVE ? (
                <Button onClick={endSession} variant="danger" className="flex-1 py-3 flex items-center justify-center gap-2">
                  <Power size={18} /> <span className="hidden sm:inline">中止连接 / </span>DISCONNECT
                </Button>
              ) : (
                <Button onClick={startSession} className={`flex-1 py-3 flex items-center justify-center gap-2 ${status === SessionStatus.CONNECTING ? 'animate-pulse' : ''}`}>
                  <Mic size={18} /> {status === SessionStatus.ERROR ? 'RETRY' : <><span className="hidden sm:inline">启动 / </span>INITIALIZE</>}
                </Button>
              )}
            </div>
          </div>

          {/* 右侧面板 - 桌面端 */}
          <div className="hidden md:flex md:col-span-3 flex-col gap-3 min-h-0">
            {/* 欺骗率大面板 */}
            <div className={`relative p-4 border-2 backdrop-blur-md transition-all duration-300 ${
              isDanger ? 'border-[#ff003c] bg-[#ff003c]/10 shadow-[0_0_30px_rgba(255,0,60,0.3)]' :
              isSuspicious ? 'border-[#ffaa00] bg-[#ffaa00]/10 shadow-[0_0_25px_rgba(255,170,0,0.2)]' :
              'border-[#00f3ff] bg-[#00f3ff]/10 shadow-[0_0_20px_rgba(0,243,255,0.2)]'
            }`}>
              <div className="flex flex-col items-center justify-center py-2">
                <div className="text-sm opacity-70 mb-2 tracking-widest font-chinese">欺骗概率 / DECEPTION RATE</div>

                <div className={`text-xl md:text-2xl font-black mb-2 font-chinese tracking-widest ${isDanger ? 'animate-pulse glitch-effect' : ''}`}>
                  {isDanger ? '【 谎 言 确 认 】' :
                   isSuspicious ? '【 高 度 可 疑 】' :
                   isTruth ? '【 诚 实 】' : '【 待 机 】'}
                </div>

                <div className={`text-6xl lg:text-7xl font-display font-black tracking-tighter transition-all duration-300 ${isDanger ? 'glitch-effect' : ''}`}
                     style={{ color: getThemeColor(), textShadow: `0 0 30px ${getThemeColor()}, 0 0 60px ${getThemeColor()}50` }}>
                  {lieProbability}<span className="text-3xl">%</span>
                </div>

                <div className="w-full h-4 bg-gray-900 mt-4 relative border border-gray-700 overflow-hidden">
                  <div className="h-full transition-all duration-500 ease-out"
                       style={{ width: `${lieProbability}%`, background: `linear-gradient(90deg, transparent, ${getThemeColor()})`, boxShadow: `0 0 10px ${getThemeColor()}` }}></div>
                  <div className="absolute top-0 bottom-0 w-[1px] bg-white/30 left-[50%]"></div>
                  <div className="absolute top-0 bottom-0 w-[1px] bg-white/30 left-[75%]"></div>
                </div>
                <div className="w-full flex justify-between text-[10px] mt-1 opacity-50 font-mono">
                  <span>0%</span><span>50%</span><span>75%</span><span>100%</span>
                </div>

                <div className="mt-4 font-chinese font-bold text-sm text-center min-h-[3rem] flex items-center justify-center border-t border-white/10 w-full pt-3 leading-relaxed opacity-90">
                  {lastAnalysis}
                </div>
              </div>
            </div>

            <Panel title="真实度趋势 / VERACITY_GRAPH" className="flex-1 min-h-[150px] flex flex-col" alert={isDanger}>
              <div className="flex-1 w-full mt-2 min-h-[100px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <YAxis domain={[0, 100]} hide />
                    <XAxis hide />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#000', borderColor: getThemeColor(), color: getThemeColor(), fontFamily: 'monospace' }}
                      itemStyle={{ color: getThemeColor() }}
                      formatter={(value: number) => [`${value}%`, '欺骗率']}
                      labelFormatter={() => ''}
                    />
                    <ReferenceLine y={50} stroke="#ffaa00" strokeDasharray="3 3" opacity={0.5} />
                    <ReferenceLine y={75} stroke="#ff003c" strokeDasharray="3 3" opacity={0.5} />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={getThemeColor()}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={true}
                      animationDuration={300}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {/* 音频输入可视化 */}
              <div className="h-6 mt-2 border-t border-white/10 pt-2 flex items-center gap-2">
                <Mic size={12} className="opacity-50" />
                <div className="flex-1 h-2 bg-gray-900 overflow-hidden">
                  <div className="h-full bg-white transition-all duration-75" style={{ width: `${Math.min(100, inputVolume * 2)}%` }}></div>
                </div>
                <span className="text-[10px] font-mono opacity-50 w-8 text-right">MIC</span>
              </div>
            </Panel>
          </div>
        </main>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.5); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: currentColor; border-radius: 2px; }
        .scanlines {
          background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.15) 50%, rgba(0,0,0,0.15));
          background-size: 100% 4px;
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 100;
        }
      `}</style>
    </div>
  );
};

export default App;
