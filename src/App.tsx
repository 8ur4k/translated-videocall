import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Peer, DataConnection, MediaConnection } from 'peerjs';
import './App.css';

// SpeechRecognition interface tanımı
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface SpeechRecognitionEvent {
  results: {
    [key: number]: {
      [key: number]: {
        transcript: string;
      };
    };
    length: number;
  };
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

// Dil seçenekleri
const languages = [
  { code: 'tr', name: 'Türkçe' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'zh', name: '中文' },
  { code: 'ar', name: 'العربية' }
];

// ID oluşturucu
const generateId = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 7; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Çeviri fonksiyonu
const translateText = async (text: string, sourceLang: string, targetLang: string): Promise<string> => {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    let translatedText = '';
    if (data && data[0]) {
      data[0].forEach((item: any) => {
        if (item[0]) {
          translatedText += item[0];
        }
      });
    }
    
    return translatedText;
  } catch (error) {
    console.error('Çeviri hatası:', error);
    return text;
  }
};

// Son 20 kelimeyi al
const getLastNWords = (text: string, n: number = 20): string => {
  const words = text.trim().split(/\s+/);
  return words.slice(-n).join(' ');
};

function App() {
  const [peer, setPeer] = useState<Peer | null>(null);
  const [myId, setMyId] = useState<string>('');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('tr');
  const [searchId, setSearchId] = useState<string>('');
  const [incomingCall, setIncomingCall] = useState<MediaConnection | null>(null);
  const [currentCall, setCurrentCall] = useState<MediaConnection | null>(null);
  const [dataConnection, setDataConnection] = useState<DataConnection | null>(null);
  const [mySubtitle, setMySubtitle] = useState<string>('');
  const [remoteSubtitle, setRemoteSubtitle] = useState<string>('');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');
  const [speechEnabled, setSpeechEnabled] = useState<boolean>(true);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const recognitionRef = useRef<any>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const isRecognitionStarting = useRef<boolean>(false);
  const abortedCount = useRef<number>(0);

  // Callback fonksiyonları
  const handleIncomingSubtitle = useCallback(async (text: string, sourceLang: string) => {
    console.log('Gelen metin:', text, 'Kaynak dil:', sourceLang, 'Hedef dil:', selectedLanguage);
    try {
      const translatedText = await translateText(text, sourceLang, selectedLanguage);
      console.log('Çevrilmiş metin:', translatedText);
      setRemoteSubtitle(getLastNWords(translatedText));
    } catch (error) {
      console.error('Çeviri hatası:', error);
      setRemoteSubtitle(getLastNWords(text));
    }
  }, [selectedLanguage]);

  const startSpeechRecognition = useCallback(() => {
    // Eğer zaten başlatma işlemi devam ediyorsa, bekle
    if (isRecognitionStarting.current) {
      console.log('Recognition zaten başlatılıyor, bekleniyor...');
      return;
    }

    // Eğer zaten bir recognition çalışıyorsa, önce onu durdur
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (error) {
        // Stop hatası normal, devam et
      }
      recognitionRef.current = null;
    }

    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      console.error('Speech recognition desteklenmiyor');
      return;
    }

    isRecognitionStarting.current = true;
    console.log('Yeni recognition oluşturuluyor...');

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    // Daha basit ayarlar deneyelim
    recognition.continuous = false; // Sürekli değil, tek seferde
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    
    const lang = selectedLanguage === 'tr' ? 'tr-TR' : 
                 selectedLanguage === 'en' ? 'en-US' :
                 selectedLanguage === 'es' ? 'es-ES' :
                 selectedLanguage === 'fr' ? 'fr-FR' :
                 selectedLanguage === 'de' ? 'de-DE' :
                 selectedLanguage === 'it' ? 'it-IT' :
                 selectedLanguage === 'pt' ? 'pt-BR' :
                 selectedLanguage === 'ru' ? 'ru-RU' :
                 selectedLanguage === 'ja' ? 'ja-JP' :
                 selectedLanguage === 'ko' ? 'ko-KR' :
                 selectedLanguage === 'zh' ? 'zh-CN' :
                 selectedLanguage === 'ar' ? 'ar-SA' : 'tr-TR';
    
    recognition.lang = lang;
    console.log('Recognition dili:', lang);

    recognition.onstart = () => {
      isRecognitionStarting.current = false;
      console.log('✅ Speech recognition başladı');
    };

    recognition.onresult = (event: any) => {
      console.log('🎤 onresult tetiklendi, event:', event);
      let transcript = '';
      let isFinal = false;
      
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        transcript += result[0].transcript;
        if (result.isFinal) {
          isFinal = true;
        }
      }
      
      console.log('🗣️ Konuşma algılandı:', transcript, 'Final:', isFinal);
      
      if (transcript.trim()) {
        setMySubtitle(getLastNWords(transcript));
        
        // Veriyi karşı tarafa gönder
        if (dataConnection && dataConnection.open) {
          console.log('📤 Veri gönderiliyor:', transcript);
          dataConnection.send({
            type: 'subtitle',
            text: transcript,
            language: selectedLanguage
          });
        } else {
          console.log('❌ Data connection yok veya kapalı');
        }
      }
    };

    recognition.onerror = (event: any) => {
      isRecognitionStarting.current = false;
      console.log('❌ Speech recognition hatası:', event.error);
      
      // 'aborted' hatası normal bir durum, sessizce geç ve yeniden başlatma
      if (event.error === 'aborted') {
        abortedCount.current += 1;
        console.log(`⚠️ Recognition aborted ${abortedCount.current} kez`);
        
        // 5 kez aborted hatası alırsa speech recognition'ı devre dışı bırak
        if (abortedCount.current >= 5) {
          console.log('🚫 Çok fazla aborted hatası - Speech Recognition devre dışı bırakılıyor');
          setSpeechEnabled(false);
          if (recognitionRef.current === recognition) {
            recognitionRef.current = null;
          }
          return;
        }
        
        // Aborted hatası durumunda recognition'ı temizle ve döngüyü kır
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
        }
        return;
      }
      
      // Diğer hataları logla
      console.error('Speech recognition hatası detay:', event);
    };

    recognition.onend = () => {
      isRecognitionStarting.current = false;
      console.log('🔚 Speech recognition sona erdi');
      
      // Sadece bağlı durumda, speech enabled ve recognition hala aktifse yeniden başlat
      if (isConnected && speechEnabled && recognitionRef.current === recognition) {
        console.log('🔄 3 saniye sonra yeniden başlatılacak...');
        setTimeout(() => {
          // Çift kontrol: hala bağlı mı, speech enabled mı ve recognition temizlenmemiş mi?
          if (isConnected && speechEnabled && !isRecognitionStarting.current && recognitionRef.current === recognition) {
            console.log('🔄 Yeniden başlatılıyor...');
            startSpeechRecognition();
          } else {
            console.log('🚫 Yeniden başlatma iptal edildi - koşullar sağlanmıyor');
          }
        }, 3000);
      } else {
        console.log('🚫 Yeniden başlatılmayacak - bağlantı yok, speech disabled veya recognition değişti');
      }
    };

    recognition.onspeechstart = () => {
      console.log('🎙️ Konuşma başladı');
    };

    recognition.onspeechend = () => {
      console.log('🤐 Konuşma bitti');
    };

    recognitionRef.current = recognition;
    
    try {
      console.log('🚀 Recognition başlatılıyor...');
      recognition.start();
    } catch (error) {
      console.error('❌ Recognition başlatma hatası:', error);
      recognitionRef.current = null;
      isRecognitionStarting.current = false;
    }
  }, [selectedLanguage, dataConnection, isConnected]);

  const stopSpeechRecognition = useCallback(() => {
    isRecognitionStarting.current = false;
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (error) {
        // Stop hatası normal, devam et
      }
      recognitionRef.current = null;
    }
  }, []);

  // Peer bağlantısını başlat
  useEffect(() => {
    const newPeer = new Peer(generateId());
    setPeer(newPeer);

    newPeer.on('open', (id) => {
      setMyId(id);
      setStatus('Hazır');
    });

    newPeer.on('call', (call) => {
      setIncomingCall(call);
      setStatus('Gelen arama...');
    });

    newPeer.on('connection', (conn) => {
      console.log('Gelen data connection:', conn.peer);
      setDataConnection(conn);
      
      conn.on('data', (data: any) => {
        console.log('Gelen veri:', data);
        if (data.type === 'subtitle') {
          handleIncomingSubtitle(data.text, data.language);
        }
      });
    });

    return () => {
      newPeer.destroy();
    };
  }, [handleIncomingSubtitle]);

  // Kamera başlat
  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        
        console.log('Kamera ve mikrofon erişimi sağlandı');
        console.log('Audio tracks:', stream.getAudioTracks().length);
        console.log('Video tracks:', stream.getVideoTracks().length);
        
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (error) {
        console.error('Kamera erişim hatası:', error);
        setStatus('Kamera erişim hatası');
      }
    };

    startCamera();

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Speech Recognition başlat
  useEffect(() => {
    console.log('Speech Recognition useEffect:', { isConnected, selectedLanguage, speechEnabled });
    
    // Önce mevcut recognition'ı temizle
    stopSpeechRecognition();
    
    // Sadece bağlı durumda ve speech enabled ise yeni recognition başlat
    if (isConnected && selectedLanguage && speechEnabled) {
      console.log('Speech Recognition başlatılacak...');
      // Uzun bir gecikme ile başlat (önceki recognition'ın tamamen durması için)
      const timeoutId = setTimeout(() => {
        if (isConnected && selectedLanguage && speechEnabled) {
          console.log('Speech Recognition başlatılıyor...');
          startSpeechRecognition();
        }
      }, 1000);
      
      return () => {
        clearTimeout(timeoutId);
        stopSpeechRecognition();
      };
    }

    return () => {
      stopSpeechRecognition();
    };
  }, [isConnected, selectedLanguage, speechEnabled, startSpeechRecognition, stopSpeechRecognition]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(myId);
    setStatus('ID kopyalandı!');
    setTimeout(() => setStatus('Hazır'), 2000);
  };

  const callUser = () => {
    if (!peer || !localStreamRef.current || !searchId.trim()) return;

    const call = peer.call(searchId, localStreamRef.current);
    setCurrentCall(call);
    setStatus('Aranıyor...');

    call.on('stream', (remoteStream) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      setIsConnected(true);
      setStatus('Bağlandı');
    });

    call.on('close', () => {
      endCall();
    });

    // Data connection oluştur
    const conn = peer.connect(searchId);
    console.log('Data connection oluşturuluyor:', searchId);
    
    conn.on('open', () => {
      console.log('Data connection açıldı');
      setDataConnection(conn);
    });

    conn.on('data', (data: any) => {
      console.log('Gelen veri (caller):', data);
      if (data.type === 'subtitle') {
        handleIncomingSubtitle(data.text, data.language);
      }
    });
  };

  const acceptCall = () => {
    if (!incomingCall || !localStreamRef.current) return;

    incomingCall.answer(localStreamRef.current);
    setCurrentCall(incomingCall);

    incomingCall.on('stream', (remoteStream) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      setIsConnected(true);
      setStatus('Bağlandı');
    });

    incomingCall.on('close', () => {
      endCall();
    });

    setIncomingCall(null);
  };

  const rejectCall = () => {
    if (incomingCall) {
      incomingCall.close();
      setIncomingCall(null);
      setStatus('Arama reddedildi');
      setTimeout(() => setStatus('Hazır'), 2000);
    }
  };

  const endCall = () => {
    if (currentCall) {
      currentCall.close();
    }
    if (dataConnection) {
      dataConnection.close();
    }

    setCurrentCall(null);
    setDataConnection(null);
    setIsConnected(false);
    setMySubtitle('');
    setRemoteSubtitle('');
    
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    // Yeni ID oluştur
    if (peer) {
      peer.destroy();
      const newPeer = new Peer(generateId());
      setPeer(newPeer);

      newPeer.on('open', (id) => {
        setMyId(id);
        setStatus('Hazır');
      });

      newPeer.on('call', (call) => {
        setIncomingCall(call);
        setStatus('Gelen arama...');
      });

      newPeer.on('connection', (conn) => {
        setDataConnection(conn);
        
        conn.on('data', (data: any) => {
          if (data.type === 'subtitle') {
            handleIncomingSubtitle(data.text, data.language);
          }
        });
      });
    }
  };

  return (
    <div className="App">
      {/* Sol video container */}
      <div className="video-container">
        <video
          ref={remoteVideoRef}
          className="video-element"
          autoPlay
          playsInline
          style={{ display: isConnected ? 'block' : 'none' }}
        />
        
        {/* Kontroller (bağlantı yokken) */}
        {!isConnected && !incomingCall && (
          <div className="controls-overlay">
            <div className="control-section">
              <label className="control-label">Dil Seçimi</label>
              <select 
                className="language-select"
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
              >
                {languages.map(lang => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="control-section">
              <label className="control-label">Sizin ID'niz</label>
              <div className="id-display">
                <input 
                  type="text" 
                  className="id-input" 
                  value={myId} 
                  readOnly 
                />
                <button className="copy-button" onClick={copyToClipboard}>
                  Kopyala
                </button>
              </div>
            </div>

            <div className="control-section">
              <label className="control-label">Arkadaşınızı Arayın</label>
              <div className="search-section">
                <input 
                  type="text" 
                  className="search-input" 
                  placeholder="ID girin (örn: wQi8C3h)"
                  value={searchId}
                  onChange={(e) => setSearchId(e.target.value)}
                />
                <button className="call-button" onClick={callUser}>
                  Ara
                </button>
              </div>
            </div>

            {status && <div className="status-message">{status}</div>}
          </div>
        )}

        {/* Gelen arama kontrolü */}
        {incomingCall && (
          <div className="call-controls">
            <button className="accept-button" onClick={acceptCall}>
              Kabul Et
            </button>
            <button className="reject-button" onClick={rejectCall}>
              Reddet
            </button>
          </div>
        )}

        {/* Aramayı bitir butonu */}
        {isConnected && (
          <button className="end-call-button" onClick={endCall}>
            ×
          </button>
        )}

        {/* Karşı tarafın altyazıları */}
        {isConnected && remoteSubtitle && (
          <div className="subtitles">
            {remoteSubtitle}
          </div>
        )}
        
        {/* Debug: Karşı taraf altyazı durumu */}
        {isConnected && (
          <div style={{ position: 'absolute', top: '10px', left: '10px', color: 'white', fontSize: '12px', background: 'rgba(0,0,0,0.7)', padding: '5px' }}>
            Remote: {remoteSubtitle || 'Yok'}
          </div>
        )}
      </div>

      {/* Sağ video container (kendi videom) */}
      <div className="video-container">
        <video
          ref={localVideoRef}
          className="video-element"
          autoPlay
          playsInline
          muted
        />

        {/* Kendi altyazılarım */}
        {isConnected && mySubtitle && (
          <div className="subtitles">
            {mySubtitle}
          </div>
        )}
        
        {/* Debug: Altyazı durumu */}
        {isConnected && (
          <div style={{ position: 'absolute', top: '10px', left: '10px', color: 'white', fontSize: '12px', background: 'rgba(0,0,0,0.7)', padding: '5px' }}>
            My: {mySubtitle || 'Yok'}<br/>
            Speech: {speechEnabled ? '✅' : '❌'}<br/>
            Aborted: {abortedCount.current}
            {!speechEnabled && (
              <button 
                onClick={() => {
                  setSpeechEnabled(true);
                  abortedCount.current = 0;
                }}
                style={{ marginLeft: '5px', fontSize: '10px', padding: '2px 5px' }}
              >
                Yeniden Etkinleştir
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;