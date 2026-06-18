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
      model: 'gemini-2.5-flash',
      systemInstruction: buildSystemPrompt(conditions)
    });

    const geminiHistory = messages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const chat = model.startChat({ history: geminiHistory });
    const lastMsg = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMsg.content);
    const reply = result.response.text();

    // 返答からスポット名を抽出してNominatimで座標を取得
    const spotNames = extractSpotNames(reply);
    const regionHint = buildRegionHint(conditions);
    console.log('[geocode] spots:', spotNames, '| region:', regionHint);
    const spots = await geocodeSpots(spotNames.slice(0, 5), regionHint);

    res.status(200).json({ reply, spots });
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: err.message || 'Gemini API の呼び出しに失敗しました' });
  }
};

// ─── スポット名の抽出 ────────────────────────────────────────
// 「1. スポット名」「2. 店名 — ジャンル」形式の行からスポット名を取り出す
function extractSpotNames(text) {
  const matches = [...text.matchAll(/^\d+\.\s+\*{0,2}([^*\n\r]+?)\*{0,2}(?:\s*[—–\-｜].*)?$/gm)];
  return [...new Set(
    matches
      .map(m => m[1].trim())
      .filter(name => name.length >= 2 && name.length <= 40)
  )];
}

// ─── 地域ヒントの構築 ────────────────────────────────────────
function buildRegionHint(cond) {
  if (!cond) return '九州';
  const parts = [];
  if (Array.isArray(cond.destination) && cond.destination.length) {
    parts.push(cond.destination[0]);
  }
  if (cond.departure && cond.departure !== '九州外・その他') {
    parts.push(cond.departure);
  }
  parts.push('九州');
  return parts.join(' ');
}

// ─── Nominatim ジオコーディング ──────────────────────────────
async function geocodeSpots(names, regionHint) {
  const spots = [];
  for (const name of names) {
    const q = `${name} ${regionHint}`;
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'kyushu-touring-chat/1.0 (https://github.com/maclarensennaevo-jpg/kyushu-touring-chat)'
        }
      });
      const data = await r.json();
      if (Array.isArray(data) && data.length > 0) {
        spots.push({ name, lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) });
        console.log(`[geocode] OK: ${name} → ${data[0].lat}, ${data[0].lon}`);
      } else {
        console.log(`[geocode] not found: ${name}`);
      }
    } catch (e) {
      console.error(`[geocode] error: ${name}`, e.message);
    }
    // Nominatim 利用規約: 1秒以上の間隔を空ける
    await new Promise(r => setTimeout(r, 1100));
  }
  return spots;
}

// ─── システムプロンプト ──────────────────────────────────────
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

  const hasGourmet = Array.isArray(cond.themes) && cond.themes.includes('グルメ');

  const gourmetSection = hasGourmet ? `
**おすすめグルメスポット**（一人でも入りやすい店を1〜2軒）：
1. 店名 — 料理ジャンル｜一言コメント
2. 店名 — 料理ジャンル｜一言コメント
` : '';

  return `あなたは九州ツーリングの専門アドバイザーです。
バイクライダーに対して実用的で具体的なツーリングアドバイスを日本語で提供してください。

## ユーザーの条件
- 出発地：${cond.departure || '不明'}
- 行きたいエリア：${dest}
- 日程：${cond.duration || '不明'}
- テーマ：${themes}
- 距離感：${cond.distance || '不明'}
- 同行人数：${cond.companions || '不明'}

## テーマの反映（必須）
選択されたテーマ「${themes}」を必ずルートとスポット選びに反映させてください。
- 「絶景・景観」→ 展望スポットや絶景ロードを優先
- 「温泉」→ 立ち寄り湯や温泉地を含める
- 「歴史・文化」→ 史跡・城・神社仏閣を優先
- 「海岸線ドライブ」→ 海沿いの快走路を中心にルート構成
- 「山岳・峠」→ 峠道・ワインディングロードを中心に
- 「定番ツーリングスポット」→ ライダーに人気の定番スポットを選ぶ
- 「穴場・秘境」→ 観光客が少ない隠れたスポットを発掘
- 「グルメ」→ 地元名物・ご当地グルメを食べられる店を必ず含める

## 最初の回答での必須フォーマット
以下の形式で回答してください（省略・変更禁止）：

**ルート名**：〇〇ルート

**おすすめスポット**：
1. スポット名
   説明（選択テーマに沿った魅力を含めて2〜3行で）
2. スポット名
   説明（2〜3行で）
3. スポット名
   説明（2〜3行で）
${gourmetSection}
**所要時間と総走行距離**：〇〇時間（総走行距離：約〇〇km）

**ルート概要**：
（ルート全体の流れや雰囲気、見どころのつながりを3〜4行で説明）

## 追加質問への対応
宿泊地・グルメ・道路状況・バイクの停め場所・温泉・給油ポイントなど、何でも答えてください。
地名や施設名は正確に記載し、存在しない情報は作らないでください。`;
}
