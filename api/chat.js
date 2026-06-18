const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY が設定されていません' });

  const { messages, conditions } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages が不正です' });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash-latest',
      systemInstruction: buildSystemPrompt(conditions)
    });

    // Gemini の history は最後のメッセージを除いた配列
    const geminiHistory = messages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const chat = model.startChat({ history: geminiHistory });
    const lastMsg = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMsg.content);
    const reply = result.response.text();

    res.status(200).json({ reply });
  } catch (err) {
    console.error('Gemini API error:', err);
    res.status(500).json({ error: err.message || 'Gemini API の呼び出しに失敗しました' });
  }
};

function buildSystemPrompt(cond) {
  if (!cond) {
    return `あなたは九州ツーリングの専門アドバイザーです。
バイクライダーに対して実用的で具体的なツーリングアドバイスを日本語で提供してください。`;
  }

  const dest = Array.isArray(cond.destination) && cond.destination.length
    ? cond.destination.join('、')
    : '指定なし（おすすめに任せる）';
  const themes = Array.isArray(cond.themes) && cond.themes.length
    ? cond.themes.join('、')
    : '指定なし';

  return `あなたは九州ツーリングの専門アドバイザーです。
バイクライダーに対して実用的で具体的なツーリングアドバイスを日本語で提供してください。

## ユーザーの条件
- 出発地：${cond.departure || '不明'}
- 行きたいエリア：${dest}
- 日程：${cond.duration || '不明'}
- テーマ：${themes}
- 距離感：${cond.distance || '不明'}
- 同行人数：${cond.companions || '不明'}

## 最初の回答での必須フォーマット
以下の形式で回答してください：

**ルート名**：〇〇ルート

**おすすめスポット**：
1. スポット名 — 説明（バイクツーリングならではの魅力も含めて）
2. スポット名 — 説明
3. スポット名 — 説明

**所要時間の目安**：〇〇時間（総走行距離：約〇〇km）

---
上記の後に、ルート概要や注意点などを補足してください。

## 追加質問への対応
宿泊地・グルメ・道路状況・バイクの停め場所・温泉・給油ポイントなど、何でも答えてください。
地名や施設名は正確に記載し、存在しない情報は作らないでください。`;
}
