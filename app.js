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

Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('https://vladmandic.github.io/face-api/model/'),
    faceapi.nets.faceExpressionNet.loadFromUri('https://vladmandic.github.io/face-api/model/')
]).then(() => {
    startBtn.innerText = "Analizi Başlat";
    startBtn.disabled = false;
    faceStatus.innerText = "Sistem Hazır";
    faceStatus.style.background = "rgba(74, 222, 128, 0.2)";
    faceStatus.style.color = "#4ade80";
}).catch(err => {
    console.error("Modeller yüklenemedi:", err);
    startBtn.innerText = "Model Yükleme Hatası";
    faceStatus.innerText = "Bağlantı Hatası";
});

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
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

        if (finalTranscript.trim().length > 5) {
            clearTimeout(aiTimeout);
            aiResult.innerText = "✍️ Analiz için bekleniyor...";
            aiTimeout = setTimeout(() => {
                if (apiKey.value.trim() !== "") {
                    analyzeWithAI(finalTranscript.trim(), currentEmotion);
                } else {
                    aiResult.innerText = "⚠️ Lütfen analiz için API anahtarınızı girin.";
                }
            }, 1000);
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
        
        video.addEventListener('loadedmetadata', () => {
            const displaySize = { width: video.videoWidth, height: video.videoHeight };
            overlay.width = displaySize.width;
            overlay.height = displaySize.height;
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
    faceStatus.innerText = "Durduruldu";
    const context = overlay.getContext('2d');
    context.clearRect(0, 0, overlay.width, overlay.height);
});

async function detectFace(displaySize) {
    if (!isAnalyzing) return;

    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.2 });
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
            fearful: "Stresli/Korkmuş", disgusted: "Tiksinti", surprised: "Şaşkın"
        };
        currentEmotion = trEmotions[dominantEmotion] || dominantEmotion;
        emotionResult.innerText = `${currentEmotion} (%${Math.round(expressions[dominantEmotion] * 100)})`;
        
        faceStatus.innerText = "Yüz Tespit Edildi";
        faceStatus.style.background = "rgba(59, 130, 246, 0.8)";
        faceStatus.style.color = "#fff";
    } else {
        emotionResult.innerText = "Yüz algılanamadı";
        faceStatus.innerText = "Yüz Aranıyor...";
        faceStatus.style.background = "rgba(239, 68, 68, 0.8)";
        faceStatus.style.color = "#fff";
    }

    detectInterval = setTimeout(() => detectFace(displaySize), 200);
}

async function analyzeWithAI(text, emotion) {
    aiResult.innerText = "🔄 Yapay Zeka analiz ediyor...";
    const modelType = aiModel.value;
    const key = apiKey.value.trim();
    
    const prompt = `Bağlam: Kullanıcı kameraya bakıp şunu söyledi: "${text}". Yüz ifadesi: ${emotion}. Soru: Bir profil uzmanı olarak, bu kişi yalan söylüyor veya gergin olabilir mi? Yanıt: (Kısa, net ve tek cümlelik doğrudan yorum yap. Markdown kullanma.)`;

    try {
        if (modelType === "gemini") {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            const data = await res.json();
            if(data.error) throw new Error(data.error.message);
            aiResult.innerText = "🤖 " + data.candidates[0].content.parts[0].text.replace(/\*/g, '');
        } else if (modelType === "openai") {
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
                body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }] })
            });
            const data = await res.json();
            if(data.error) throw new Error(data.error.message);
            aiResult.innerText = "🤖 " + data.choices[0].message.content.replace(/\*/g, '');
        }
    } catch (err) {
        console.error(err);
        aiResult.innerText = "❌ API Hatası: " + (err.message || "Bağlantı kurulamadı.");
    }
}
