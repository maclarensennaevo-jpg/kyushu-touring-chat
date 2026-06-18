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

    // Gemini の history は最後のメッセージを除いた配列
    const geminiHistory = messages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const chat = model.startChat({ history: geminiHistory });
    const lastMsg = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMsg.content);
    const raw = result.response.text();

    // <SPOTS_JSON>...</SPOTS_JSON> を抽出してフロントへ渡す
    const spotsMatch = raw.match(/<SPOTS_JSON>([\s\S]*?)<\/SPOTS_JSON>/i);
    let spots = [];
    let reply = raw;
    if (spotsMatch) {
      try {
        // Gemini がコードブロックで囲んだ場合も除去して解析
        const jsonStr = spotsMatch[1].replace(/```(?:json)?/g, '').trim();
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) spots = parsed;
      } catch (e) {
        console.error('SPOTS_JSON parse error:', e.message, spotsMatch[1]);
      }
      reply = raw.replace(/<SPOTS_JSON>[\s\S]*?<\/SPOTS_JSON>/gi, '').trim();
    } else {
      console.warn('SPOTS_JSON not found in response');
    }

    res.status(200).json({ reply, spots });
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

## 位置情報の提供（必須）
返答の末尾に、紹介したすべてのスポット・店舗の緯度経度を必ず以下の形式で出力してください。
マークダウンのコードブロックは使わず、タグをそのまま出力してください。

<SPOTS_JSON>
[{"name":"スポット名","lat":緯度の数値,"lng":経度の数値},{"name":"スポット名2","lat":緯度,"lng":経度}]
</SPOTS_JSON>

## 追加質問への対応
宿泊地・グルメ・道路状況・バイクの停め場所・温泉・給油ポイントなど、何でも答えてください。
地名や施設名は正確に記載し、存在しない情報は作らないでください。`;
}
