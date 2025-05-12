const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(express.json()); // 新增：解析JSON请求体
app.use(cors());

const UPLOAD_DIR = path.resolve(__dirname, 'uploads');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 修复后的存储配置
const chunkStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      // 确保hash参数存在
      const hash = req.body.hash;
      if (!hash) {
        return cb(new Error('Missing hash parameter'));
      }

      const chunkDir = path.join(UPLOAD_DIR, hash); // 改用path.join更安全
      if (!fs.existsSync(chunkDir)) {
        fs.mkdirSync(chunkDir, { recursive: true });
      }
      cb(null, chunkDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    try {
      // 确保index参数存在
      const index = req.body.index;
      if (typeof index === 'undefined') {
        return cb(new Error('Missing index parameter'));
      }
      cb(null, `${index}`); // 直接使用数字作为文件名
    } catch (err) {
      cb(err);
    }
  }
});

const upload = multer({
  storage: chunkStorage,
  limits: { fileSize: 100 * 1024 * 1024 } // 限制单个分片100MB
});

// 检查分片接口
app.get('/api/check', (req, res) => {
  const hash = req.query.hash; // 使用query参数
  if (!hash) {
    return res.status(400).json({ error: 'Missing hash parameter' });
  }

  const chunkDir = path.join(UPLOAD_DIR, hash);
  if (!fs.existsSync(chunkDir)) {
    return res.json({ data: [] });
  }

  const chunks = fs.readdirSync(chunkDir)
    .filter(name => !isNaN(parseInt(name))) // 过滤有效分片
    .map(Number)
    .sort((a, b) => a - b);

  res.json({ data: chunks });
});

// 分片上传接口（关键修复）
app.post('/api/upload', 
  upload.array('files'), // 必须作为第一个中间件
  (req, res) => {
    // 添加参数验证
    if (!req.body.hash || typeof req.body.index === 'undefined') {
      return res.status(400).json({ error: 'Missing parameters' });
    }
    res.json({ code: 0 });
  }
);

// 合并接口
app.post('/api/merge', async (req, res) => {
  const { hash, filename } = req.body;
  if (!hash || !filename) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const chunkDir = path.join(UPLOAD_DIR, hash);
  const outputPath = path.join(UPLOAD_DIR, filename);

  try {
    // 获取排序后的分片列表
    const chunks = fs.readdirSync(chunkDir)
      .map(Number)
      .sort((a, b) => a - b)
      .map(n => path.join(chunkDir, n.toString()));

    // 创建写入流
    const writeStream = fs.createWriteStream(outputPath);
    
    // 递归合并分片
    const mergeChunks = (index) => {
      if (index >= chunks.length) {
        writeStream.end(() => {
          // 清理临时目录
          fs.rmSync(chunkDir, { recursive: true });
          res.json({ code: 0 });
        });
        return;
      }

      const readStream = fs.createReadStream(chunks[index]);
      readStream.pipe(writeStream, { end: false });
      readStream.on('end', () => mergeChunks(index + 1));
    };

    mergeChunks(0);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});