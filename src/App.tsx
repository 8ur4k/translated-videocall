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
  { code: 'tr', name: '🇹🇷 Türkçe' },
  { code: 'en', name: '🇺🇸 English' },
  { code: 'es', name: '🇪🇸 Español' },
  { code: 'fr', name: '🇫🇷 Français' },
  { code: 'de', name: '🇩🇪 Deutsch' },
  { code: 'it', name: '🇮🇹 Italiano' },
  { code: 'pt', name: '🇧🇷 Português' },
  { code: 'ru', name: '🇷🇺 Русский' },
  { code: 'ja', name: '🇯🇵 日本語' },
  { code: 'ko', name: '🇰🇷 한국어' },
  { code: 'zh', name: '🇨🇳 中文' },
  { code: 'ar', name: '🇸🇦 العربية' },
  { code: 'hi', name: '🇮🇳 हिन्दी' },
  { code: 'nl', name: '🇳🇱 Nederlands' },
  { code: 'sv', name: '🇸🇪 Svenska' },
  { code: 'no', name: '🇳🇴 Norsk' },
  { code: 'da', name: '🇩🇰 Dansk' },
  { code: 'fi', name: '🇫🇮 Suomi' }
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
  const [speechEnabled, setSpeechEnabled] = useState<boolean>(true);
  const [isCalling, setIsCalling] = useState<boolean>(false);
  const [callStatus, setCallStatus] = useState<string>(''); // 'calling', 'rejected', ''
  const [showCopySuccess, setShowCopySuccess] = useState<boolean>(false);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const recognitionRef = useRef<any>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const isRecognitionStarting = useRef<boolean>(false);
  const abortedCount = useRef<number>(0);
  
  // Altyazı zamanlama ref'leri
  const mySubtitleTimer = useRef<NodeJS.Timeout | null>(null);
  const remoteSubtitleTimer = useRef<NodeJS.Timeout | null>(null);
  const myCurrentText = useRef<string>('');
  const remoteCurrentText = useRef<string>('');
  const myLastUpdateTime = useRef<number>(0);
  const remoteLastUpdateTime = useRef<number>(0);
  const myPreviousText = useRef<string>(''); // Önceki metni takip et
  const remotePreviousText = useRef<string>('');
  const lastFinalText = useRef<string>(''); // Son final metin
  const pendingInterimText = useRef<string>(''); // Bekleyen interim metin

  // SpeechRecognition yeniden başlatma fonksiyonu
  const restartSpeechRecognition = useCallback(() => {
    if (recognitionRef.current && speechEnabled && isConnected) {
      console.log('🔄 SpeechRecognition yeniden başlatılıyor...');
      try {
        recognitionRef.current.stop();
        setTimeout(() => {
          if (speechEnabled && isConnected) {
            // Yeni recognition oluştur
            const newPeer = peer;
            if (newPeer) {
              // startSpeechRecognition'ı çağırmak yerine doğrudan yeni recognition oluştur
              if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
                console.error('Speech recognition desteklenmiyor');
                return;
              }

              isRecognitionStarting.current = true;
              console.log('Yeni recognition oluşturuluyor...');

              const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
              const recognition = new SpeechRecognition();
              
              recognition.continuous = true;
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
                           selectedLanguage === 'ar' ? 'ar-SA' :
                           selectedLanguage === 'hi' ? 'hi-IN' :
                           selectedLanguage === 'nl' ? 'nl-NL' :
                           selectedLanguage === 'sv' ? 'sv-SE' :
                           selectedLanguage === 'no' ? 'no-NO' :
                           selectedLanguage === 'da' ? 'da-DK' :
                           selectedLanguage === 'fi' ? 'fi-FI' : 'tr-TR';
              
              recognition.lang = lang;
              
              recognition.onstart = () => {
                isRecognitionStarting.current = false;
                console.log('✅ Yeni Speech recognition başladı');
              };

              recognition.onresult = (event: any) => {
                let fullTranscript = '';
                for (let i = 0; i < event.results.length; i++) {
                  const result = event.results[i];
                  fullTranscript += result[0].transcript;
                }
                
                if (fullTranscript.trim()) {
                  updateMySubtitle(fullTranscript);
                  
                  if (dataConnection && dataConnection.open) {
                    dataConnection.send({
                      type: 'subtitle',
                      text: fullTranscript,
                      language: selectedLanguage
                    });
                  }
                }
              };

              recognition.onerror = (event: any) => {
                isRecognitionStarting.current = false;
                if (event.error !== 'aborted') {
                  console.error('Speech recognition hatası:', event.error);
                }
              };

              recognition.onend = () => {
                isRecognitionStarting.current = false;
                if (isConnected && speechEnabled && recognitionRef.current === recognition) {
                  setTimeout(() => {
                    if (isConnected && speechEnabled && !isRecognitionStarting.current && recognitionRef.current === recognition) {
                      try {
                        recognition.start();
                        isRecognitionStarting.current = true;
                      } catch (error) {
                        console.error('❌ Hızlı yeniden başlatma hatası:', error);
                      }
                    }
                  }, 100);
                }
              };

              recognitionRef.current = recognition;
              
              try {
                recognition.start();
              } catch (error) {
                console.error('❌ Recognition başlatma hatası:', error);
                recognitionRef.current = null;
                isRecognitionStarting.current = false;
              }
            }
          }
        }, 200);
      } catch (error) {
        console.error('SpeechRecognition yeniden başlatma hatası:', error);
      }
    }
  }, [speechEnabled, isConnected, selectedLanguage, dataConnection, peer]);

  // Basit altyazı yönetim fonksiyonu
  const updateMySubtitle = useCallback((newText: string) => {
    console.log('📝 Yeni metin geldi:', newText);
    
    // Eğer yeni metin önceki metinle aynı ise (tekrar), işleme
    if (newText === myPreviousText.current) {
      console.log('🔄 Aynı metin tekrar geldi, işlenmiyor');
      return;
    }
    
    // Her zaman yeni metni olduğu gibi göster (SpeechRecognition zaten birikimli veriyor)
    myCurrentText.current = newText;
    myPreviousText.current = newText;
    myLastUpdateTime.current = Date.now();
    
    console.log('✅ Altyazı güncellendi:', newText);
    
    // Metni göster
    const displayText = getLastNWords(myCurrentText.current);
    setMySubtitle(displayText);
    
    // Mevcut timer'ı temizle
    if (mySubtitleTimer.current) {
      clearTimeout(mySubtitleTimer.current);
    }
    
    // 5 saniye sonra altyazıyı kaldır ve SpeechRecognition'ı yeniden başlat
    mySubtitleTimer.current = setTimeout(() => {
      console.log('🫥 5 saniye sessizlik - altyazı kayboldu, SpeechRecognition yeniden başlatılıyor');
      setMySubtitle('');
      myCurrentText.current = '';
      myPreviousText.current = '';
      myLastUpdateTime.current = 0;
      lastFinalText.current = '';
      pendingInterimText.current = '';
      
      // SpeechRecognition'ı yeniden başlat (hafızasını temizlemek için)
      restartSpeechRecognition();
    }, 5000);
  }, [restartSpeechRecognition]);

  const updateRemoteSubtitle = useCallback(async (newText: string, sourceLang: string, isFinal?: boolean) => {
    console.log('📨 Karşı taraf yeni metin geldi:', `"${newText}"`, 'Final:', isFinal, 'Uzunluk:', newText.length);
    console.log('📨 Önceki metin:', `"${remotePreviousText.current}"`, 'Uzunluk:', remotePreviousText.current.length);
    
    // Metin uzunluğu kontrolü - yeni metin öncekinden kısa ise (kelime eksikse) işleme
    const isTextShorter = newText.length < remotePreviousText.current.length;
    const isSameText = newText === remotePreviousText.current;
    const isTextLonger = newText.length > remotePreviousText.current.length;
    
    console.log('📊 Metin analizi:', { isSameText, isTextShorter, isTextLonger, isFinal });
    
    // Final mesajları her zaman işle
    if (isFinal) {
      console.log('🎯 Final metin işleniyor:', `"${newText}"`);
    } else {
      // Interim mesajlarda: sadece tam aynı metin ise skip et (kısalma veya uzama varsa işle)
      if (isSameText) {
        console.log('🔄 Karşı taraf aynı metin tekrar geldi, işlenmiyor');
        return;
      }
      
      // Eğer metin kısaldıysa uyar ama yine de işle
      if (isTextShorter) {
        console.log('⚠️ SORUN: Metin kısaldı! Bu normalmi?');
        console.log('⚠️ Önceki:', `"${remotePreviousText.current}" (${remotePreviousText.current.length} karakter)`);
        console.log('⚠️ Yeni:', `"${newText}" (${newText.length} karakter)`);
        
        // Kısa metin gelirse, en uzun olanı tercih et (son tam mesajı koru)
        if (remotePreviousText.current.length > newText.length && remotePreviousText.current.includes(newText)) {
          console.log('🚫 Kısa metin skip ediliyor, önceki daha uzun ve bu metni içeriyor');
          return;
        }
      }
    }
    
    // Her zaman yeni metni olduğu gibi çevir (karşı taraftan gelen zaten birikimli)
    remoteCurrentText.current = newText;
    remotePreviousText.current = newText;
    remoteLastUpdateTime.current = Date.now();
    
    console.log('✅ Karşı taraf altyazısı güncelleniyor:', `"${newText}"`);
    
    try {
      const translatedText = await translateText(newText, sourceLang, selectedLanguage);
      console.log('🌍 Çevrilmiş metin:', `"${translatedText}" (${translatedText.length} karakter)`);
      
      // Çevrilmiş metni göster
      const displayText = getLastNWords(translatedText);
      setRemoteSubtitle(displayText);
      
      // Mevcut timer'ı temizle
      if (remoteSubtitleTimer.current) {
        clearTimeout(remoteSubtitleTimer.current);
      }
      
      // Final mesajlarda timer'ı biraz uzat (daha uzun görünsün)
      const timeoutDuration = isFinal ? 7000 : 5000;
      
      // Timer ile altyazıyı kaldır
      remoteSubtitleTimer.current = setTimeout(() => {
        console.log('🫥 Karşı taraf sessizlik - altyazı kayboldu');
        setRemoteSubtitle('');
        remoteCurrentText.current = '';
        remotePreviousText.current = '';
        remoteLastUpdateTime.current = 0;
      }, timeoutDuration);
    } catch (error) {
      console.error('Çeviri hatası:', error);
      setRemoteSubtitle(getLastNWords(newText));
    }
  }, [selectedLanguage]);

  // Callback fonksiyonları
  const handleIncomingSubtitle = useCallback(async (text: string, sourceLang: string, isFinal?: boolean) => {
    console.log('📨 Gelen metin:', text, 'Kaynak dil:', sourceLang, 'Hedef dil:', selectedLanguage, 'Final:', isFinal);
    updateRemoteSubtitle(text, sourceLang, isFinal);
  }, [selectedLanguage, updateRemoteSubtitle]);

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
    
    // Sürekli dinleme için ayarlar
    recognition.continuous = true; // Sürekli dinle, durma
    recognition.interimResults = true; // Ara sonuçları da al
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
                 selectedLanguage === 'ar' ? 'ar-SA' :
                 selectedLanguage === 'hi' ? 'hi-IN' :
                 selectedLanguage === 'nl' ? 'nl-NL' :
                 selectedLanguage === 'sv' ? 'sv-SE' :
                 selectedLanguage === 'no' ? 'no-NO' :
                 selectedLanguage === 'da' ? 'da-DK' :
                 selectedLanguage === 'fi' ? 'fi-FI' : 'tr-TR';
    
    recognition.lang = lang;
    console.log('Recognition dili:', lang);

    recognition.onstart = () => {
      isRecognitionStarting.current = false;
      console.log('✅ Speech recognition başladı');
    };

    recognition.onresult = (event: any) => {
      console.log('🎤 onresult tetiklendi, results:', event.results.length);
      
      // Final ve interim sonuçları ayır
      let finalTranscript = '';
      let interimTranscript = '';
      let hasNewFinal = false;
      
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        
        if (result.isFinal) {
          finalTranscript += transcript;
          hasNewFinal = true;
        } else {
          interimTranscript += transcript;
        }
      }
      
      const fullTranscript = finalTranscript + interimTranscript;
      console.log('🗣️ Final:', finalTranscript, 'Interim:', interimTranscript, 'Yeni final:', hasNewFinal);
      
      if (fullTranscript.trim()) {
        // Her zaman güncel metni göster (final + interim)
        updateMySubtitle(fullTranscript);
        
        // Karşı tarafa gönderme stratejisi:
        if (hasNewFinal && finalTranscript.trim()) {
          // Yeni final sonuç varsa, onu öncelikli gönder
          lastFinalText.current = finalTranscript;
          pendingInterimText.current = interimTranscript;
          
          if (dataConnection && dataConnection.open) {
            console.log('📤 Final veri gönderiliyor:', finalTranscript);
            console.log('📤 Final veri uzunluğu:', finalTranscript.length, 'kelime sayısı:', finalTranscript.split(' ').length);
            dataConnection.send({
              type: 'subtitle',
              text: finalTranscript,
              language: selectedLanguage,
              isFinal: true
            });
          }
        } else if (interimTranscript.trim() && !hasNewFinal) {
          // Sadece interim varsa ve yeni final yoksa, tam metni gönder
          const textToSend = lastFinalText.current + interimTranscript;
          
          if (dataConnection && dataConnection.open) {
            console.log('📤 Interim veri gönderiliyor:', textToSend);
            console.log('📤 Interim veri uzunluğu:', textToSend.length, 'kelime sayısı:', textToSend.split(' ').length);
            console.log('📤 LastFinal:', lastFinalText.current, 'Interim:', interimTranscript);
            dataConnection.send({
              type: 'subtitle',
              text: textToSend,
              language: selectedLanguage,
              isFinal: false
            });
          }
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
      console.log('🔚 Speech recognition sona erdi - hemen yeniden başlatılacak');
      
      // Sürekli çalışması için hemen yeniden başlat
      if (isConnected && speechEnabled && recognitionRef.current === recognition) {
        console.log('🔄 Hemen yeniden başlatılıyor...');
        setTimeout(() => {
          // Çift kontrol: hala bağlı mı, speech enabled mı ve recognition temizlenmemiş mi?
          if (isConnected && speechEnabled && !isRecognitionStarting.current && recognitionRef.current === recognition) {
            console.log('🚀 Hızlı yeniden başlatma...');
            try {
              recognition.start();
              isRecognitionStarting.current = true;
            } catch (error) {
              console.error('❌ Hızlı yeniden başlatma hatası:', error);
            }
          } else {
            console.log('🚫 Yeniden başlatma iptal edildi - koşullar sağlanmıyor');
          }
        }, 100); // Çok kısa gecikme - kesinti olmasın
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
  }, [selectedLanguage, dataConnection, isConnected, speechEnabled, updateMySubtitle]);

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

  // Peer bağlantısını başlat (sadece component mount'ta)
  useEffect(() => {
    const newPeer = new Peer(generateId(), {
      config: {
        iceServers: [
          {
            urls: 'stun:stun.l.google.com:19302'
          }
        ],
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-compat',
        rtcpMuxPolicy: 'require',
        iceCandidatePoolSize: 0
      },
      debug: 3
    });
    setPeer(newPeer);

    newPeer.on('open', (id) => {
      console.log('🌐 Peer bağlantısı açıldı, ID:', id);
      setMyId(id);
    });

    newPeer.on('call', (call) => {
      console.log('📞 Gelen arama:', call.peer);
      setIncomingCall(call);
    });

    newPeer.on('error', (error) => {
      console.error('❌ Peer hatası:', error);
    });

    newPeer.on('disconnected', () => {
      console.log('🔌 Peer bağlantısı kesildi');
    });

    newPeer.on('connection', (conn) => {
      console.log('Gelen data connection:', conn.peer);
      setDataConnection(conn);
      
      conn.on('data', (data: any) => {
        console.log('📨 Gelen veri:', data);
        if (data.type === 'subtitle') {
          handleIncomingSubtitle(data.text, data.language, data.isFinal);
        } else if (data.type === 'call_rejected') {
          console.log('Arama reddedildi!');
          setCallStatus('rejected');
          setIsCalling(true); // Input disabled kalsın
          setTimeout(() => {
            setIsCalling(false);
            setCallStatus('');
          }, 1000);
        } else if (data.type === 'call_cancelled') {
          console.log('Arama iptal edildi!');
          // Gelen arama bildirimini kaldır
          setIncomingCall(null);
        } else if (data.type === 'connection_test') {
          console.log('✅ Data connection test başarılı:', data.message);
          // Test mesajına cevap gönder
          conn.send({
            type: 'connection_test_response',
            message: 'Data connection test response'
          });
        } else if (data.type === 'connection_test_response') {
          console.log('✅ Data connection test response alındı:', data.message);
        }
      });
    });

    return () => {
      newPeer.destroy();
    };
  }, []); // handleIncomingSubtitle dependency'sini kaldırdık

  // Kamera başlat
  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 320, max: 640 },
            height: { ideal: 240, max: 480 },
            frameRate: { ideal: 15, max: 30 }
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 44100
          }
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
      }
    };

    startCamera();

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      // Timer'ları temizle
      if (mySubtitleTimer.current) {
        clearTimeout(mySubtitleTimer.current);
      }
      if (remoteSubtitleTimer.current) {
        clearTimeout(remoteSubtitleTimer.current);
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
    setShowCopySuccess(true);
    setTimeout(() => setShowCopySuccess(false), 1000);
  };

  const callUser = () => {
    if (!peer || !localStreamRef.current || !searchId.trim()) return;

    setIsCalling(true);
    setCallStatus('calling');
    const callStartTime = Date.now();
    const call = peer.call(searchId, localStreamRef.current);
    setCurrentCall(call);

    call.on('stream', (remoteStream) => {
      console.log('🎥 Karşı taraftan stream geldi:', remoteStream);
      console.log('🎥 Stream tracks:', remoteStream.getTracks());
      
      // Stream track bilgilerini detaylı logla
      remoteStream.getTracks().forEach((track, index) => {
        console.log(`Track ${index}:`, {
          kind: track.kind,
          enabled: track.enabled,
          readyState: track.readyState,
          settings: track.getSettings && track.getSettings()
        });
      });
      
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      setIsConnected(true);
      setIsCalling(false);
      setCallStatus('');
    });

    // WebRTC connection monitoring
    call.peerConnection.addEventListener('connectionstatechange', () => {
      const state = call.peerConnection.connectionState;
      console.log('🔗 Connection state:', state);
      
      if (state === 'failed' || state === 'disconnected') {
        console.error('❌ Bağlantı başarısız!', state);
        // Bağlantı başarısız olursa yeniden dene
        setTimeout(() => {
          if (!isConnected) {
            console.log('🔄 Bağlantı yeniden deneniyor...');
            setCallStatus('');
            setIsCalling(false);
          }
        }, 2000);
      }
    });

    call.peerConnection.addEventListener('iceconnectionstatechange', () => {
      const state = call.peerConnection.iceConnectionState;
      console.log('🧊 ICE connection state:', state);
      
      if (state === 'failed') {
        console.error('❌ ICE bağlantısı başarısız!', state);
        // Bağlantıyı sonlandır, kullanıcı yeniden denemeli
        setIsCalling(false);
        setCallStatus('');
        if (currentCall) {
          currentCall.close();
        }
      } else if (state === 'disconnected') {
        console.warn('⚠️ ICE bağlantısı koptu');
      } else if (state === 'connected' || state === 'completed') {
        console.log('✅ ICE bağlantısı başarılı!', state);
      }
    });

    call.peerConnection.addEventListener('icegatheringstatechange', () => {
      console.log('🧊 ICE gathering state:', call.peerConnection.iceGatheringState);
    });

    // ICE candidate events
    call.peerConnection.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        console.log('🧊 ICE candidate:', event.candidate.type, event.candidate.protocol);
      } else {
        console.log('🧊 ICE gathering tamamlandı');
      }
    });

    // Data channel monitoring
    call.peerConnection.addEventListener('datachannel', (event) => {
      console.log('📡 Data channel event:', event.channel.label);
    });

    call.on('close', () => {
      // Eğer bağlı durumda ise normal kapatma
      if (isConnected) {
        endCall();
      } else {
        // Hızlı close (500ms içinde) reddetme anlamına gelir
        const callDuration = Date.now() - callStartTime;
        if (callDuration < 500) {
          console.log('Hızlı close - reddetme olarak yorumlanıyor');
          setCallStatus('rejected');
          setIsCalling(true); // Input disabled kalsın
          setTimeout(() => {
            setIsCalling(false);
            setCallStatus('');
          }, 1000);
        } else {
          // Normal timeout veya iptal
          setIsCalling(false);
          setCallStatus('');
        }
      }
    });

    // Data connection oluştur
    const conn = peer.connect(searchId, {
      reliable: true,
      serialization: 'json'
    });
    console.log('Data connection oluşturuluyor:', searchId);
    
    conn.on('open', () => {
      console.log('✅ Data connection açıldı');
      setDataConnection(conn);
      
      // Test mesajı gönder
      conn.send({
        type: 'connection_test',
        message: 'Data connection test'
      });
    });

    conn.on('error', (error) => {
      console.error('❌ Data connection hatası:', error);
    });

    conn.on('close', () => {
      console.log('🔌 Data connection kapandı');
    });

    conn.on('data', (data: any) => {
      console.log('📨 Gelen veri (caller):', data);
      if (data.type === 'subtitle') {
        handleIncomingSubtitle(data.text, data.language, data.isFinal);
      } else if (data.type === 'call_rejected') {
        console.log('Arama reddedildi!');
        setCallStatus('rejected');
        setIsCalling(true); // Input disabled kalsın
        setTimeout(() => {
          setIsCalling(false);
          setCallStatus('');
        }, 1000);
      } else if (data.type === 'call_cancelled') {
        console.log('Arama iptal edildi!');
        // Gelen arama bildirimini kaldır
        setIncomingCall(null);
      } else if (data.type === 'connection_test') {
        console.log('✅ Data connection test başarılı:', data.message);
        // Test mesajına cevap gönder
        conn.send({
          type: 'connection_test_response',
          message: 'Data connection test response'
        });
      } else if (data.type === 'connection_test_response') {
        console.log('✅ Data connection test response alındı:', data.message);
      }
    });
  };

  const acceptCall = () => {
    if (!incomingCall || !localStreamRef.current) return;

    incomingCall.answer(localStreamRef.current);
    setCurrentCall(incomingCall);

    incomingCall.on('stream', (remoteStream) => {
      console.log('🎥 Gelen aramadan stream geldi:', remoteStream);
      console.log('🎥 Stream tracks:', remoteStream.getTracks());
      
      // Stream track bilgilerini detaylı logla
      remoteStream.getTracks().forEach((track, index) => {
        console.log(`Track ${index}:`, {
          kind: track.kind,
          enabled: track.enabled,
          readyState: track.readyState,
          settings: track.getSettings && track.getSettings()
        });
        
        // Track events
        track.onended = () => console.log(`❌ Track ${index} (${track.kind}) ended`);
        track.onmute = () => console.log(`🔇 Track ${index} (${track.kind}) muted`);
        track.onunmute = () => console.log(`🔊 Track ${index} (${track.kind}) unmuted`);
      });
      
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
        
        // Video element events
        remoteVideoRef.current.onloadedmetadata = () => {
          console.log('📹 Video metadata yüklendi');
        };
        remoteVideoRef.current.oncanplay = () => {
          console.log('▶️ Video oynatmaya hazır');
        };
        remoteVideoRef.current.onerror = (e) => {
          console.error('❌ Video element hatası:', e);
        };
      }
      setIsConnected(true);
    });

    incomingCall.on('close', () => {
      endCall();
    });

    setIncomingCall(null);
  };

  const rejectCall = () => {
    if (incomingCall) {
      // Reddetme sinyali göndermek için call'ı kısa süre answer edip hemen kapat
      try {
        // Boş bir stream ile answer et (sadece sinyal için)
        const emptyStream = new MediaStream();
        incomingCall.answer(emptyStream);
        
        // Hemen kapat (bu arayan tarafa close sinyali gönderir)
        setTimeout(() => {
          incomingCall.close();
        }, 100);
        
        // Ayrıca data connection ile de reddetme mesajı gönder
        if (peer) {
          const rejectConnection = peer.connect(incomingCall.peer);
          rejectConnection.on('open', () => {
            rejectConnection.send({
              type: 'call_rejected'
            });
            setTimeout(() => {
              rejectConnection.close();
            }, 100);
          });
        }
      } catch (error) {
        console.log('Reddetme sinyali gönderme hatası:', error);
        incomingCall.close();
      }
      
      setIncomingCall(null);
    }
  };

  const cancelCall = () => {
    if (currentCall && !isConnected) {
      console.log('Arama iptal ediliyor...');
      
      // Karşı tarafa iptal mesajı gönder
      if (peer && searchId) {
        const cancelConnection = peer.connect(searchId);
        cancelConnection.on('open', () => {
          cancelConnection.send({
            type: 'call_cancelled'
          });
          setTimeout(() => {
            cancelConnection.close();
          }, 100);
        });
      }
      
      // Call'ı kapat
      currentCall.close();
      setCurrentCall(null);
      setIsCalling(false);
      setCallStatus('');
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
    setIsCalling(false);
    setCallStatus('');
    setMySubtitle('');
    setRemoteSubtitle('');
    
    // Timer'ları temizle
    if (mySubtitleTimer.current) {
      clearTimeout(mySubtitleTimer.current);
      mySubtitleTimer.current = null;
    }
    if (remoteSubtitleTimer.current) {
      clearTimeout(remoteSubtitleTimer.current);
      remoteSubtitleTimer.current = null;
    }
    
    // Metin ref'lerini temizle
    myCurrentText.current = '';
    remoteCurrentText.current = '';
    myPreviousText.current = '';
    remotePreviousText.current = '';
    myLastUpdateTime.current = 0;
    remoteLastUpdateTime.current = 0;
    lastFinalText.current = '';
    pendingInterimText.current = '';
    
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    // Yeni ID oluştur
    if (peer) {
      peer.destroy();
      const newPeer = new Peer(generateId(), {
        config: {
          iceServers: [
            {
              urls: 'stun:stun.l.google.com:19302'
            }
          ],
          iceTransportPolicy: 'all',
          bundlePolicy: 'max-compat',
          rtcpMuxPolicy: 'require',
          iceCandidatePoolSize: 0
        },
        debug: 3
      });
      setPeer(newPeer);

      newPeer.on('open', (id) => {
        setMyId(id);
      });

      newPeer.on('call', (call) => {
        setIncomingCall(call);
      });

      newPeer.on('connection', (conn) => {
        setDataConnection(conn);
        
        conn.on('data', (data: any) => {
          if (data.type === 'subtitle') {
            handleIncomingSubtitle(data.text, data.language, data.isFinal);
          } else if (data.type === 'call_rejected') {
            console.log('Arama reddedildi!');
            setCallStatus('rejected');
            setIsCalling(true); // Input disabled kalsın
            setTimeout(() => {
              setIsCalling(false);
              setCallStatus('');
            }, 1000);
          } else if (data.type === 'call_cancelled') {
            console.log('Arama iptal edildi!');
            // Gelen arama bildirimini kaldır
            setIncomingCall(null);
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
                  value={showCopySuccess ? "Kopyalandı!" : myId}
                  readOnly 
                />
                <button className="copy-button" onClick={copyToClipboard}>
                  📋
                </button>
              </div>
            </div>

            <div className="control-section">
              <label className="control-label">Arkadaşınızı Arayın</label>
              <div className="search-section">
                <input 
                  type="text" 
                  className="search-input" 
                  placeholder={isCalling ? "" : "ID girin (örn: wQi8C3h)"}
                  value={
                    callStatus === 'calling' ? `${searchId} Aranıyor...` :
                    callStatus === 'rejected' ? `${searchId} Reddetti.` :
                    searchId
                  }
                  onChange={(e) => setSearchId(e.target.value)}
                  disabled={isCalling}
                />
                <button 
                  className={isCalling ? "call-button calling" : "call-button"} 
                  onClick={isCalling ? cancelCall : callUser}
                  disabled={false}
                >
                </button>
              </div>
            </div>

          </div>
        )}

        {/* Gelen arama göstergesi */}
        {incomingCall && (
          <div className="incoming-call">
            <div className="caller-id">{incomingCall.peer}</div>
            <div className="call-status">sizi arıyor...</div>
            <div className="call-actions">
              <button className="accept-button" onClick={acceptCall}>
                Kabul Et
              </button>
              <button className="reject-button" onClick={rejectCall}>
                Reddet
              </button>
            </div>
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
        
      </div>
    </div>
  );
}

export default App;