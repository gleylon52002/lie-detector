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
let lastTranscript = "";
let recognition;
let detectInterval;

// Speech Recognition Setup
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'tr-TR';

    recognition.onresult = (event) => {
        const transcript = event.results[event.results.length - 1][0].transcript.trim();
        transcriptResult.innerText = transcript;
        lastTranscript = transcript;
        
        if (apiKey.value.trim() !== "") {
            analyzeWithAI(transcript, currentEmotion);
        } else {
            aiResult.innerText = "Lütfen AI yorumu için API anahtarınızı girin.";
        }
    };
    
    recognition.onerror = (e) => console.error("Ses tanıma hatası:", e);
} else {
    transcriptResult.innerText = "Tarayıcınız ses tanımayı desteklemiyor (Chrome veya Edge kullanın).";
}

// Face API Models Load
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
    if (recognition) recognition.stop();
    emotionResult.innerText = "Bekleniyor...";
});

async function detectFace(displaySize) {
    if (!isAnalyzing) return;

    const detections = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceExpressions();
    
    if (detections) {
        const resizedDetections = faceapi.resizeResults(detections, displaySize);
        const context = overlay.getContext('2d');
        context.clearRect(0, 0, overlay.width, overlay.height);
        faceapi.draw.drawDetections(overlay, resizedDetections);
        
        const expressions = detections.expressions;
        const dominantEmotion = Object.keys(expressions).reduce((a, b) => expressions[a] > expressions[b] ? a : b);
        
        const trEmotions = {
            neutral: "Nötr", happy: "Mutlu", sad: "Üzgün", angry: "Kızgın",
            fearful: "Korkmuş/Stresli", disgusted: "Tiksinti", surprised: "Şaşkın"
        };
        currentEmotion = trEmotions[dominantEmotion] || dominantEmotion;
        emotionResult.innerText = `${currentEmotion} (%${Math.round(expressions[dominantEmotion] * 100)})`;
    }

    detectInterval = setTimeout(() => detectFace(displaySize), 500); // 2 FPS to save CPU
}

async function analyzeWithAI(text, emotion) {
    aiResult.innerText = "Yapay Zeka analiz ediyor...";
    const modelType = aiModel.value;
    const key = apiKey.value.trim();
    
    const prompt = `Bir kullanıcı kameraya bakarak şu cümleyi kurdu: "${text}". Bu sırada yüzünde tespit edilen baskın duygu durumu: "${emotion}". Bir yalan makinesi veya profil uzmanı gibi davran. Bu duygu ve cümlenin bağlamına göre kişi yalan söylüyor veya gergin olabilir mi? Kısa, net, 2-3 cümlelik bir analiz yap. Türkçe cevap ver.`;

    try {
        if (modelType === "gemini") {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${key}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            const data = await res.json();
            aiResult.innerText = data.candidates[0].content.parts[0].text;
        } else if (modelType === "openai") {
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
                body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: prompt }] })
            });
            const data = await res.json();
            aiResult.innerText = data.choices[0].message.content;
        }
    } catch (err) {
        console.error(err);
        aiResult.innerText = "API Bağlantı Hatası. Anahtarınızı kontrol edin.";
    }
}
