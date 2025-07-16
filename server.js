const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Multer konfigürasyonu
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 10 // Maksimum 10 dosya
    }
});

// Google Drive API konfigürasyonu
const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || './google-credentials.json',
    scopes: ['https://www.googleapis.com/auth/drive.file']
});

const drive = google.drive({ version: 'v3', auth });

// Email transporter
const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'ozgurkan2025@gmail.com',
        pass: process.env.EMAIL_PASS || 'your-app-password'
    }
});

// Ana sayfa
app.get('/', (req, res) => {
    res.json({ 
        message: 'Düğün Anıları API',
        version: '1.0.0',
        endpoints: {
            upload: '/upload',
            health: '/health'
        }
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Dosya yükleme endpoint'i
app.post('/upload', upload.fields([
    { name: 'photos', maxCount: 10 },
    { name: 'audio', maxCount: 1 }
]), async (req, res) => {
    try {
        const photos = req.files['photos'] || [];
        const audio = req.files['audio'] || [];
        const uploadedFiles = [];

        // Google Drive'da klasör oluştur
        const folderName = `DugunAnilari_${new Date().toISOString().split('T')[0]}`;
        const folder = await createFolderIfNotExists(folderName);

        // Fotoğrafları yükle
        for (let i = 0; i < photos.length; i++) {
            const photo = photos[i];
            const fileName = `Foto_${i + 1}_${Date.now()}.jpg`;
            
            const fileMetadata = {
                name: fileName,
                parents: [folder.id]
            };

            const media = {
                mimeType: photo.mimetype,
                body: photo.buffer
            };

            const file = await drive.files.create({
                requestBody: fileMetadata,
                media: media,
                fields: 'id,name,webViewLink'
            });

            uploadedFiles.push({
                type: 'photo',
                name: fileName,
                id: file.data.id,
                link: file.data.webViewLink
            });
        }

        // Ses dosyasını yükle
        if (audio.length > 0) {
            const audioFile = audio[0];
            const fileName = `Ses_${Date.now()}.wav`;
            
            const fileMetadata = {
                name: fileName,
                parents: [folder.id]
            };

            const media = {
                mimeType: audioFile.mimetype,
                body: audioFile.buffer
            };

            const file = await drive.files.create({
                requestBody: fileMetadata,
                media: media,
                fields: 'id,name,webViewLink'
            });

            uploadedFiles.push({
                type: 'audio',
                name: fileName,
                id: file.data.id,
                link: file.data.webViewLink
            });
        }

        // Email bildirimi gönder
        await sendEmailNotification(folderName, uploadedFiles);

        res.json({
            success: true,
            message: `${uploadedFiles.length} dosya başarıyla yüklendi!`,
            files: uploadedFiles,
            folderLink: `https://drive.google.com/drive/folders/${folder.id}`
        });

    } catch (error) {
        console.error('Yükleme hatası:', error);
        res.status(500).json({
            success: false,
            message: 'Dosyalar yüklenirken bir hata oluştu.',
            error: error.message
        });
    }
});

// Google Drive'da klasör oluştur
async function createFolderIfNotExists(folderName) {
    try {
        // Mevcut klasörü ara
        const response = await drive.files.list({
            q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id,name)'
        });

        if (response.data.files.length > 0) {
            return response.data.files[0];
        }

        // Yeni klasör oluştur
        const folderMetadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder'
        };

        const folder = await drive.files.create({
            requestBody: folderMetadata,
            fields: 'id,name'
        });

        return folder.data;
    } catch (error) {
        console.error('Klasör oluşturma hatası:', error);
        throw error;
    }
}

// Email bildirimi gönder
async function sendEmailNotification(folderName, files) {
    try {
        const photoCount = files.filter(f => f.type === 'photo').length;
        const audioCount = files.filter(f => f.type === 'audio').length;

        const mailOptions = {
            from: process.env.EMAIL_USER || 'ozgurkan2025@gmail.com',
            to: process.env.EMAIL_USER || 'ozgurkan2025@gmail.com',
            subject: '💒 Yeni Düğün Anıları Yüklendi!',
            html: `
                <h2>Düğün Anıları Sitenize Yeni Dosyalar Yüklendi!</h2>
                <p><strong>Klasör:</strong> ${folderName}</p>
                <p><strong>Fotoğraf Sayısı:</strong> ${photoCount}</p>
                <p><strong>Ses Kaydı Sayısı:</strong> ${audioCount}</p>
                <p><strong>Tarih:</strong> ${new Date().toLocaleString('tr-TR')}</p>
                <br>
                <p>Google Drive'ınızda kontrol edebilirsiniz.</p>
                <p>💝 Düğün anıları siteniz</p>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log('Email bildirimi gönderildi');
    } catch (error) {
        console.error('Email gönderme hatası:', error);
    }
}

// Server'ı başlat
app.listen(PORT, () => {
    console.log(`Server ${PORT} portunda çalışıyor`);
    console.log(`Health check: http://localhost:${PORT}/health`);
});
