const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const aiModel = document.getElementById('aiModel');
const apiKey = document.getElementById('apiKey');
const emotionResult = document.getElementById('emotionResult');
const transcriptResult = document.getElementById('transcriptResult');
const aiResult = document.getElementById('aiResult');

let isAnalyzing = false;
let currentEmotion = "Nötr";
let recognition;
let detectInterval;
let aiTimeout;

// Modelleri Yükle
Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('https://vladmandic.github.io/face-api/model/'),
    faceapi.nets.faceExpressionNet.loadFromUri('https://vladmandic.github.io/face-api/model/')
]).then(() => {
    startBtn.innerText = "Analizi Başlat";
    startBtn.disabled = false;
}).catch(err => {
    console.error("Modeller yüklenemedi:", err);
    startBtn.innerText = "Model Yükleme Hatası";
});

// Ses Tanıma Ayarları
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true; // Anlık kelimeleri gör ama API'ye yollama
    recognition.lang = 'tr-TR';

    recognition.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        if (finalTranscript || interimTranscript) {
            transcriptResult.innerText = finalTranscript || interimTranscript;
        }

        // Token tasarrufu: Sadece kullanıcı cümleyi bitirdiğinde (isFinal) veya 2 saniye sustuğunda AI'ya yolla
        if (finalTranscript.trim().length > 5) {
            clearTimeout(aiTimeout);
            aiTimeout = setTimeout(() => {
                if (apiKey.value.trim() !== "") {
                    analyzeWithAI(finalTranscript.trim(), currentEmotion);
                } else {
                    aiResult.innerText = "Lütfen analiz için API anahtarınızı girin.";
                }
            }, 1500); // 1.5 saniye bekle (cümle tam bitsin)
        }
    };
    
    recognition.onerror = (e) => console.error("Ses tanıma hatası:", e);
} else {
    transcriptResult.innerText = "Tarayıcınız ses tanımayı desteklemiyor.";
}

startBtn.addEventListener('click', async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        video.srcObject = stream;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        isAnalyzing = true;
        
        if (recognition) recognition.start();
        
        video.addEventListener('play', () => {
            const displaySize = { width: video.videoWidth, height: video.videoHeight };
            faceapi.matchDimensions(overlay, displaySize);
            detectFace(displaySize);
        });
    } catch (err) {
        alert("Kamera ve mikrofon izni gereklidir.");
        console.error(err);
    }
});

stopBtn.addEventListener('click', () => {
    const stream = video.srcObject;
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    isAnalyzing = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    clearTimeout(detectInterval);
    clearTimeout(aiTimeout);
    if (recognition) recognition.stop();
    emotionResult.innerText = "Bekleniyor...";
});

async function detectFace(displaySize) {
    if (!isAnalyzing) return;

    // Yüz tespiti eşiğini düşürerek daha rahat algılamasını sağladık (inputSize 160 -> 224, scoreThreshold 0.5 -> 0.3)
    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 });
    const detections = await faceapi.detectSingleFace(video, options).withFaceExpressions();
    
    const context = overlay.getContext('2d');
    context.clearRect(0, 0, overlay.width, overlay.height);

    if (detections) {
        const resizedDetections = faceapi.resizeResults(detections, displaySize);
        faceapi.draw.drawDetections(overlay, resizedDetections);
        
        const expressions = detections.expressions;
        const dominantEmotion = Object.keys(expressions).reduce((a, b) => expressions[a] > expressions[b] ? a : b);
        
        const trEmotions = {
            neutral: "Nötr", happy: "Mutlu", sad: "Üzgün", angry: "Kızgın",
            fearful: "Korkmuş/Stresli", disgusted: "Tiksinti", surprised: "Şaşkın"
        };
        currentEmotion = trEmotions[dominantEmotion] || dominantEmotion;
        emotionResult.innerText = `${currentEmotion} (%${Math.round(expressions[dominantEmotion] * 100)})`;
    } else {
        emotionResult.innerText = "Yüz algılanamadı (Kameraya tam bakın)";
    }

    detectInterval = setTimeout(() => detectFace(displaySize), 500); // Saniyede 2 kez (Performans için)
}

async function analyzeWithAI(text, emotion) {
    aiResult.innerText = "Yapay Zeka analiz ediyor...";
    const modelType = aiModel.value;
    const key = apiKey.value.trim();
    
    // Prompt optimize edildi (Minimum token, maksimum netlik)
    const prompt = `Bağlam: Kullanıcı "${text}" dedi. Yüz ifadesi: ${emotion}. Soru: Bu kişi yalan söylüyor veya gergin olabilir mi? Yanıt: (Kısa, net, tek cümlelik analiz)`;

    try {
        if (modelType === "gemini") {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            const data = await res.json();
            if(data.error) throw new Error(data.error.message);
            aiResult.innerText = data.candidates[0].content.parts[0].text;
        } else if (modelType === "openai") {
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
                body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }] })
            });
            const data = await res.json();
            if(data.error) throw new Error(data.error.message);
            aiResult.innerText = data.choices[0].message.content;
        }
    } catch (err) {
        console.error(err);
        aiResult.innerText = "API Hatası: " + (err.message || "Bağlantı kurulamadı.");
    }
}