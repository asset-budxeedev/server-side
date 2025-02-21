import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import multer from 'multer';
import fs from 'fs';
import cors from 'cors';
import path from 'path';
import FormData from 'form-data';

dotenv.config();

if (!process.env.STABILITY_API_KEY || !process.env.OPENAI_API_KEY) {
  console.error('Environment variables STABILITY_API_KEY atau OPENAI_API_KEY tidak ditemukan.');
  process.exit(1);
}

const app = express(); 
const port = process.env.PORT || 4000;

const corsOptions = {
  origin: 'https://serverbudxeedev.up.railway.app', 
};

app.use(cors(corsOptions));
app.use(express.json());

app.post('/generate-image', async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt tidak boleh kosong!' });
  }

  const form = new FormData();
  form.append('prompt', prompt);
  form.append('output_format', 'jpeg');

  try {
    const response = await axios.post(
      'https://api.stability.ai/v2beta/stable-image/generate/core',
      form,
      {
        headers: {
          Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
          Accept: 'image/*',
          ...form.getHeaders(),
        },
        responseType: 'arraybuffer', 
        validateStatus: (status) => true,
      }
    );

    if (response.status === 200) {

      const imageBuffer = Buffer.from(response.data);
      const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
      res.json({ image: base64Image });
    } else {
      const errorResponse = JSON.parse(response.data.toString());
      res.status(response.status).json({ error: errorResponse.errors[0] || 'Unknown error occurred.' });
    }

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const chatHistories = {};

const updateChatHistory = (userId, role, content) => {
  if (!chatHistories[userId]) {
    chatHistories[userId] = [];
  }
  chatHistories[userId].push({ role, content });
};

app.post('/api/chat', async (req, res) => {
  const { userId, message } = req.body;

  if (!userId || !message) {
    return res.status(400).json({ error: 'User ID dan pesan wajib diisi.' });
  }

  try {
    updateChatHistory(userId, 'user', message);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', 
      messages: chatHistories[userId],
    });

    const aiResponse = completion.choices[0].message.content;

    updateChatHistory(userId, 'assistant', aiResponse);

    res.json({ response: aiResponse });
  } catch (error) {
    console.error(error);
    res.status(500).send('Terjadi kesalahan pada server.');
  }
});

const uploadDir = path.join('uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const fileTypes = /jpeg|jpg|png/;
    const extName = fileTypes.test(path.extname(file.originalname).toLowerCase());
    const mimeType = fileTypes.test(file.mimetype);
    if (extName && mimeType) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar (JPEG/PNG) yang diizinkan.'));
    }
  },
});

app.post('/upload-image', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Tidak ada gambar yang diunggah.' });
  }

  const imagePath = path.join(uploadDir, req.file.filename);

  try {
    const imageAnalysisResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an AI assistant that can analyze images and answer questions about them.' },
        { role: 'user', content: 'Analyze this image.' },
      ],
    });

    const imageDescription = imageAnalysisResponse.choices[0].message.content;

    res.json({ message: 'Gambar berhasil diunggah dan dianalisis.', description: imageDescription });
  } catch (error) {
    console.error('Error analyzing image:', error);
    res.status(500).json({ error: 'Gagal menganalisis gambar.' });
  } finally {
    fs.unlink(imagePath, (err) => {
      if (err) console.error('Error deleting file:', err);
    });
  }
});

app.use('/uploads', express.static(uploadDir)); 

app.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
});
