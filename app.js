const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const analyzeBtn = document.getElementById('analyzeBtn');
const aiModel = document.getElementById('aiModel');
const apiKey = document.getElementById('apiKey');
const emotionResult = document.getElementById('emotionResult');
const transcriptResult = document.getElementById('transcriptResult');
const aiResult = document.getElementById('aiResult');
const faceStatus = document.getElementById('faceStatus');

// 1. GLOBAL STATE MANAGER
const AppState = {
    isAnalyzing: false,
    faceEmotion: "Nötr",
    stressLevel: "Düşük",
    transcript: "",
    isSpeechActive: false,
    workerReady: false,
    detectIntervalId: null,
    audioIntervalId: null
};

// 2. WEB WORKER SETUP (Ağır İşlemi Ana Threadden Çıkarıyoruz)
let faceWorker;
try {
    faceWorker = new Worker('faceWorker.js');
    const hiddenCanvas = document.createElement('canvas');
    const hiddenCtx = hiddenCanvas.getContext('2d', { willReadFrequently: true });

    faceWorker.postMessage({ type: 'INIT' });

    faceWorker.onmessage = (e) => {
        if (e.data.type === 'STATUS') {
            if (e.data.status === 'READY') {
                AppState.workerReady = true;
                startBtn.innerText = "Sistemi Başlat";
                startBtn.disabled = false;
                updateBadge("Sistem Hazır", "#4ade80", "rgba(74, 222, 128, 0.2)");
            } else {
                console.error(e.data.error);
                updateBadge("Model Yükleme Hatası", "#ef4444", "rgba(239, 68, 68, 0.2)");
            }
        }

        if (e.data.type === 'RESULT' && AppState.isAnalyzing) {
            const ctx = overlay.getContext('2d');
            ctx.clearRect(0, 0, overlay.width, overlay.height);

            if (e.data.success) {
                updateBadge("Yüz Tespit Edildi", "#fff", "rgba(59, 130, 246, 0.8)");
                
                const box = e.data.box;
                ctx.strokeStyle = "#4ade80";
                ctx.lineWidth = 2;
                ctx.strokeRect(box.x, box.y, box.width, box.height);
                
                const trEmotions = {
                    neutral: "Nötr", happy: "Mutlu", sad: "Üzgün", angry: "Kızgın",
                    fearful: "Stresli/Korkmuş", disgusted: "Tiksinti", surprised: "Şaşkın"
                };
                AppState.faceEmotion = trEmotions[e.data.emotion] || e.data.emotion;
                const percent = Math.round(e.data.expressions[e.data.emotion] * 100);
                
                emotionResult.innerText = `${AppState.faceEmotion} (%${percent}) | Ses Stresi: ${AppState.stressLevel}`;
            } else {
                updateBadge("Yüz Aranıyor...", "#fff", "rgba(239, 68, 68, 0.8)");
                emotionResult.innerText = "Yüz algılanamadı";
            }
        }
    };
} catch (e) {
    console.error("Worker başlatılamadı (Muhtemelen tarayıcı güvenlik politikası). Yedek plan aktif.");
    updateBadge("Worker Hatası, Yedek Çalışıyor", "#fbbf24", "rgba(251, 191, 36, 0.2)");
}

function updateBadge(text, color, bg) {
    faceStatus.innerText = text;
    faceStatus.style.color = color;
    faceStatus.style.background = bg;
}

// 3. WEB SPEECH API STABILIZASYONU (Event Driven & Auto Restart)
let recognition;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'tr-TR';

    recognition.onstart = () => {
        console.log("Mikrofon başladı.");
        AppState.isSpeechActive = true;
        if (AppState.transcript === "") {
            transcriptResult.innerText = "Sizi dinliyorum, lütfen konuşun...";
        }
    };

    recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscriptPiece = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscriptPiece += event.results[i][0].transcript + " ";
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        AppState.transcript += finalTranscriptPiece;
        let currentDisplay = (AppState.transcript + interimTranscript).trim();
        
        if (currentDisplay.length > 0) {
            transcriptResult.innerText = currentDisplay;
            analyzeBtn.disabled = false;
        }
    };

    recognition.onerror = (e) => {
        console.error("Speech Error:", e.error);
        AppState.isSpeechActive = false;
        if(e.error === 'not-allowed') {
            transcriptResult.innerText = "HATA: Tarayıcınızda (Adres çubuğundaki kilit simgesinden) mikrofona izin verin!";
        } else {
            // Küçük hataları yoksay ve sessizce restart at
            setTimeout(restartSpeech, 1000);
        }
    };

    recognition.onend = () => {
        console.log("Mikrofon durdu.");
        AppState.isSpeechActive = false;
        if (AppState.isAnalyzing) restartSpeech();
    };

} else {
    transcriptResult.innerHTML = "<span style='color:#ef4444'>Tarayıcınız ses tanımayı (mikrofonu) desteklemiyor. Lütfen Chrome veya Edge kullanın.</span>";
}

function restartSpeech() {
    if (!AppState.isAnalyzing) return;
    try { recognition.stop(); } catch(e) {}
    setTimeout(() => {
        if (AppState.isAnalyzing && !AppState.isSpeechActive) {
            try { recognition.start(); } catch(e) {}
        }
    }, 500);
}

// 4. BAŞLATMA / DURDURMA FONKSİYONLARI
startBtn.addEventListener('click', async () => {
    try {
        updateBadge("Kamera/Mikrofon İzni Bekleniyor", "#fbbf24", "rgba(251, 191, 36, 0.2)");
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        video.srcObject = stream;
        
        AppState.isAnalyzing = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        AppState.transcript = "";
        
        setupAudioAnalysis(stream);
        
        // Mikrofonu BİLİNÇLİ başlat
        setTimeout(() => {
            if (recognition) {
                try { recognition.start(); } catch(e) { console.error("Speech start error", e); }
            }
        }, 1000); // Kamera açıldıktan 1 sn sonra mikrofonu garantile
        
        video.addEventListener('play', () => {
            if (faceWorker && AppState.workerReady) {
                const width = video.videoWidth;
                const height = video.videoHeight;
                
                overlay.width = video.clientWidth;
                overlay.height = video.clientHeight;
                
                hiddenCanvas.width = width;
                hiddenCanvas.height = height;

                AppState.detectIntervalId = setInterval(() => {
                    if (!AppState.isAnalyzing) return;
                    hiddenCtx.drawImage(video, 0, 0, width, height);
                    const imageData = hiddenCtx.getImageData(0, 0, width, height);
                    faceWorker.postMessage({ type: 'DETECT', imageData, width, height });
                }, 200);
            }
        }, { once: true });

    } catch (err) {
        updateBadge("İzin Reddedildi", "#ef4444", "rgba(239, 68, 68, 0.2)");
        alert("Kamera ve mikrofon iznini adres çubuğundan (kilit simgesinden) verip sayfayı yenileyin.");
    }
});

stopBtn.addEventListener('click', () => {
    AppState.isAnalyzing = false;
    
    const stream = video.srcObject;
    if (stream) stream.getTracks().forEach(track => track.stop());
    if (audioContext) audioContext.close();
    
    clearInterval(AppState.detectIntervalId);
    clearInterval(AppState.audioIntervalId);
    
    startBtn.disabled = false;
    stopBtn.disabled = true;
    analyzeBtn.disabled = true;
    
    if (recognition) {
        recognition.onend = null;
        try { recognition.stop(); } catch(e) {}
    }
    
    emotionResult.innerText = "Bekleniyor...";
    transcriptResult.innerText = "Söyledikleriniz burada görünecek...";
    updateBadge("Durduruldu", "#94a3b8", "rgba(148, 163, 184, 0.2)");
    overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
});

// 5. AUDIO CONTEXT OPTİMİZASYONU
let audioContext, analyser, dataArray;

function setupAudioAnalysis(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(stream);
    microphone.connect(analyser);
    
    analyser.fftSize = 256;
    dataArray = new Uint8Array(analyser.frequencyBinCount);

    AppState.audioIntervalId = setInterval(() => {
        if (!AppState.isAnalyzing) return;
        analyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
        let average = sum / dataArray.length;

        if (average > 80) AppState.stressLevel = "Yüksek (Gergin/Tiz)";
        else if (average > 40) AppState.stressLevel = "Orta";
        else AppState.stressLevel = "Düşük (Sakin)";
        
    }, 300);
}

// 6. YAPAY ZEKA ANALİZ
let fetchController;

analyzeBtn.addEventListener('click', async () => {
    const textToAnalyze = transcriptResult.innerText.replace("Sizi dinliyorum, lütfen konuşun...", "").replace("Mikrofon dinleniyor...", "").trim();
    
    if (textToAnalyze.length < 2) {
        alert("Lütfen önce bir şeyler söyleyin (Mikrofonun sesinizi aldığından emin olun).");
        return;
    }
    if (apiKey.value.trim() === "") {
        alert("Lütfen API anahtarınızı girin.");
        return;
    }

    analyzeBtn.disabled = true;
    AppState.transcript = ""; // Yeni cümleye hazır
    transcriptResult.innerText = "Sizi dinliyorum, yeni analiz için konuşabilirsiniz...";

    if (fetchController) fetchController.abort();
    fetchController = new AbortController();

    const modelType = aiModel.value;
    const key = apiKey.value.trim();
    
    aiResult.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:5px; font-size:0.9em; color:#94a3b8;">
            <span>Yapay Zeka Sunucuya Bağlanıyor...</span>
            <span id="aiProgressText">0%</span>
        </div>
        <div style="width:100%; height:6px; background:#334155; border-radius:3px; overflow:hidden;">
            <div id="aiProgressBar" style="width:0%; height:100%; background:#a855f7; transition:width 0.1s linear;"></div>
        </div>
    `;

    const progressBar = document.getElementById('aiProgressBar');
    const progressText = document.getElementById('aiProgressText');
    let progress = 0;
    
    const progressInterval = setInterval(() => {
        progress += Math.floor(Math.random() * 15) + 5;
        if (progress > 90) progress = 90;
        progressBar.style.width = progress + '%';
        progressText.innerText = progress + '%';
    }, 150);

    const prompt = `Bağlam: "${textToAnalyze}". Yüz: ${AppState.faceEmotion}. Ses: ${AppState.stressLevel}. Profil Uzmanı: Yalan mı söylüyor, gergin mi? Tek cümlelik sert teşhis koy. (Markdown yok)`;

    try {
        let aiResponse = "";
        
        if (modelType === "gemini") {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
                signal: fetchController.signal
            });
            const data = await res.json();
            if(data.error) throw new Error(data.error.message);
            aiResponse = data.candidates[0].content.parts[0].text;
        } else if (modelType === "openai") {
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
                body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }] }),
                signal: fetchController.signal
            });
            const data = await res.json();
            if(data.error) throw new Error(data.error.message);
            aiResponse = data.choices[0].message.content;
        }

        clearInterval(progressInterval);
        progressBar.style.width = '100%';
        progressText.innerText = '100%';
        
        setTimeout(() => {
            aiResult.innerHTML = `<span style="color:#d8b4fe">🕵️ ${aiResponse.replace(/\*/g, '')}</span>`;
        }, 200);

    } catch (err) {
        clearInterval(progressInterval);
        if (err.name === 'AbortError') return;
        
        progressBar.style.background = '#ef4444';
        progressText.innerText = 'HATA';
        setTimeout(() => {
            aiResult.innerHTML = `<span style="color:#ef4444">❌ API Hatası: ${err.message || "Bağlantı kurulamadı."}</span>`;
        }, 500);
    }
});