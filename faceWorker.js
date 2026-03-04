importScripts("https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js");

let modelsLoaded = false;

async function loadModels() {
    // Model dosyalarını public dizinden yükler (OffscreenWorker için gerekli)
    try {
        await faceapi.nets.tinyFaceDetector.loadFromUri('/lie-detector/models');
        await faceapi.nets.faceExpressionNet.loadFromUri('/lie-detector/models');
        modelsLoaded = true;
        postMessage({ type: 'STATUS', status: 'READY' });
    } catch (err) {
        console.error("Worker Model Hatası:", err);
        postMessage({ type: 'STATUS', status: 'ERROR', error: err.message });
    }
}

self.onmessage = async (e) => {
    if (e.data.type === 'INIT') {
        await loadModels();
        return;
    }

    if (e.data.type === 'DETECT') {
        if (!modelsLoaded) return;

        const { imageData, width, height } = e.data;
        
        // OffscreenCanvas yaratarak ImageData'yı canvas'a çevir
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);

        try {
            const detections = await faceapi.detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.2 })).withFaceExpressions();
            
            if (detections) {
                const expressions = detections.expressions;
                const dominantEmotion = Object.keys(expressions).reduce((a, b) => expressions[a] > expressions[b] ? a : b);
                
                // Algılanan yüzün koordinatlarını ve baskın duyguyu geri gönder
                postMessage({ 
                    type: 'RESULT', 
                    success: true,
                    emotion: dominantEmotion,
                    expressions: expressions,
                    box: detections.detection.box
                });
            } else {
                postMessage({ type: 'RESULT', success: false });
            }
        } catch (err) {
            console.error("Face Detection Hatası:", err);
        }
    }
};