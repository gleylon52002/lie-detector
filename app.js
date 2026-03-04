const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const aiModel = document.getElementById('aiModel');
const apiKey = document.getElementById('apiKey');
const emotionResult = document.getElementById('emotionResult');
const transcriptResult = document.getElementById('transcriptResult');
const aiResult = document.getElementById('aiResult');
const faceStatus = document.getElementById('faceStatus');

let isAnalyzing = false;
let currentEmotion = "Nötr";
let recognition;
let detectInterval;
let aiTimeout;
let audioContext, analyser, microphone, dataArray;
let currentVocalStress = "Düşük";
let lastFinalTranscript = "";

// 1. Modelleri Yükle
Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('https://vladmandic.github.io/face-api/model/'),
    faceapi.nets.faceExpressionNet.loadFromUri('https://vladmandic.github.io/face-api/model/')
]).then(() => {
    startBtn.innerText = "Analizi Başlat";
    startBtn.disabled = false;
    updateBadge("Sistem Hazır", "#4ade80", "rgba(74, 222, 128, 0.2)");
}).catch(err => {
    console.error("Modeller yüklenemedi:", err);
    startBtn.innerText = "Model Yükleme Hatası";
    updateBadge("Bağlantı Hatası", "#ef4444", "rgba(239, 68, 68, 0.2)");
});

function updateBadge(text, color, bg) {
    faceStatus.innerText = text;
    faceStatus.style.color = color;
    faceStatus.style.background = bg;
}

// 2. Ses Analizi (Anlık Metin)
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'tr-TR';

    recognition.onresult = (event) => {
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                lastFinalTranscript += event.results[i][0].transcript + " ";
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        // Anlık olarak ekrana yaz
        transcriptResult.innerText = lastFinalTranscript + interimTranscript;

        clearTimeout(aiTimeout);
        let fullText = (lastFinalTranscript + interimTranscript).trim();
        
        if (fullText.length > 5) {
            aiResult.innerHTML = "<em>Cümle bitimi dinleniyor...</em>";
            aiTimeout = setTimeout(() => {
                if (apiKey.value.trim() !== "") {
                    analyzeWithAI(fullText, currentEmotion, currentVocalStress);
                    lastFinalTranscript = ""; // Sorgudan sonra temizle
                } else {
                    aiResult.innerHTML = "<span style='color:#ef4444'>⚠️ Lütfen API anahtarınızı girin.</span>";
                }
            }, 1000); // Sadece 1 saniye susarsa hemen AI yolla
        }
    };
    recognition.onerror = (e) => {
        console.error("Ses tanıma hatası:", e.error);
    };
} else {
    transcriptResult.innerText = "Tarayıcınız ses tanımayı desteklemiyor.";
}

// 3. Başlatma Fonksiyonu
startBtn.addEventListener('click', async () => {
    try {
        updateBadge("Kamera İzni Bekleniyor", "#fbbf24", "rgba(251, 191, 36, 0.2)");
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        video.srcObject = stream;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        isAnalyzing = true;
        lastFinalTranscript = "";
        
        setupAudioAnalysis(stream);

        if (recognition) {
            try { recognition.start(); } catch(e) {}
        }
        
        video.addEventListener('play', () => {
            const displaySize = { width: video.clientWidth, height: video.clientHeight };
            overlay.width = displaySize.width;
            overlay.height = displaySize.height;
            faceapi.matchDimensions(overlay, displaySize);
            detectFace(displaySize);
        });
    } catch (err) {
        updateBadge("İzin Reddedildi", "#ef4444", "rgba(239, 68, 68, 0.2)");
        alert("Kamera ve mikrofon izni vermeniz gerekiyor.");
    }
});

stopBtn.addEventListener('click', () => {
    const stream = video.srcObject;
    if (stream) stream.getTracks().forEach(track => track.stop());
    if (audioContext) audioContext.close();
    
    isAnalyzing = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    clearTimeout(detectInterval);
    clearTimeout(aiTimeout);
    if (recognition) recognition.stop();
    
    emotionResult.innerText = "Bekleniyor...";
    updateBadge("Durduruldu", "#94a3b8", "rgba(148, 163, 184, 0.2)");
    const context = overlay.getContext('2d');
    context.clearRect(0, 0, overlay.width, overlay.height);
});

// 4. Ses Tonu & Stres Analizi
function setupAudioAnalysis(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    microphone = audioContext.createMediaStreamSource(stream);
    microphone.connect(analyser);
    analyser.fftSize = 256;
    dataArray = new Uint8Array(analyser.frequencyBinCount);

    function checkStress() {
        if (!isAnalyzing) return;
        analyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
        let average = sum / dataArray.length;

        if (average > 80) currentVocalStress = "Yüksek (Gergin/Tiz)";
        else if (average > 40) currentVocalStress = "Orta";
        else currentVocalStress = "Düşük (Sakin)";
        
        requestAnimationFrame(checkStress);
    }
    checkStress();
}

// 5. Yüz Tespiti Döngüsü
async function detectFace(displaySize) {
    if (!isAnalyzing) return;

    displaySize = { width: video.clientWidth, height: video.clientHeight };
    faceapi.matchDimensions(overlay, displaySize);

    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.2 });
    const detections = await faceapi.detectSingleFace(video, options).withFaceExpressions();
    
    const context = overlay.getContext('2d');
    context.clearRect(0, 0, overlay.width, overlay.height);

    if (detections) {
        updateBadge("Yüz Tespit Edildi", "#fff", "rgba(59, 130, 246, 0.8)");
        
        const resizedDetections = faceapi.resizeResults(detections, displaySize);
        faceapi.draw.drawDetections(overlay, resizedDetections);
        
        const expressions = detections.expressions;
        const dominantEmotion = Object.keys(expressions).reduce((a, b) => expressions[a] > expressions[b] ? a : b);
        
        const trEmotions = {
            neutral: "Nötr", happy: "Mutlu", sad: "Üzgün", angry: "Kızgın",
            fearful: "Stresli/Korkmuş", disgusted: "Tiksinti", surprised: "Şaşkın"
        };
        currentEmotion = trEmotions[dominantEmotion] || dominantEmotion;
        emotionResult.innerText = `${currentEmotion} (%${Math.round(expressions[dominantEmotion] * 100)}) | Ses Stresi: ${currentVocalStress}`;
        
    } else {
        updateBadge("Yüz Aranıyor...", "#fff", "rgba(239, 68, 68, 0.8)");
        emotionResult.innerText = "Yüz algılanamadı";
    }

    detectInterval = setTimeout(() => detectFace(displaySize), 100); // Daha da hızlandırıldı
}

// 6. Yapay Zeka (İlerleme Çubuğu ve API)
async function analyzeWithAI(text, emotion, vocalStress) {
    const modelType = aiModel.value;
    const key = apiKey.value.trim();
    
    // İlerleme Animasyonu (Anlık Hissiyat)
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
    
    // Sahte bir yükleme animasyonu (API cevabını beklerken can sıkıntısını alır)
    const progressInterval = setInterval(() => {
        progress += Math.floor(Math.random() * 15) + 5;
        if (progress > 90) progress = 90; // Yüzde 90'da bekler (API yanıtına kadar)
        progressBar.style.width = progress + '%';
        progressText.innerText = progress + '%';
    }, 150);

    const prompt = `Bağlam: "${text}". Yüz: ${emotion}. Ses: ${vocalStress}. Profil Uzmanı: Yalan mı söylüyor, gergin mi? Tek cümlelik sert teşhis koy. (Markdown yok)`;

    try {
        let aiResponse = "";
        if (modelType === "gemini") {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            const data = await res.json();
            if(data.error) throw new Error(data.error.message);
            aiResponse = data.candidates[0].content.parts[0].text;
        } else if (modelType === "openai") {
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
                body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }] })
            });
            const data = await res.json();
            if(data.error) throw new Error(data.error.message);
            aiResponse = data.choices[0].message.content;
        }

        // Başarılı tamamlama
        clearInterval(progressInterval);
        progressBar.style.width = '100%';
        progressText.innerText = '100%';
        
        setTimeout(() => {
            aiResult.innerHTML = `<span style="color:#d8b4fe">🕵️ ${aiResponse.replace(/\*/g, '')}</span>`;
        }, 200);

    } catch (err) {
        clearInterval(progressInterval);
        progressBar.style.background = '#ef4444';
        progressText.innerText = 'HATA';
        setTimeout(() => {
            aiResult.innerHTML = `<span style="color:#ef4444">❌ API Hatası: ${err.message || "Bağlantı kurulamadı."}</span>`;
        }, 500);
    }
}