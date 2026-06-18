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
    const reply = injectGourmetMapLinks(result.response.text());

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

// ─── グルメスポットにGoogleマップリンクを注入 ────────────────
// グルメセクションの各行に [GMAP:店名|市区町村名] マーカーを付与する
// フロントの md() 関数でこのマーカーを <a> タグに変換する
function injectGourmetMapLinks(text) {
  const lines = text.split('\n');
  let inGourmet = false;
  return lines.map(line => {
    if (line.includes('おすすめグルメスポット')) { inGourmet = true; return line; }
    // 次の ** 見出しでグルメセクション終了
    if (inGourmet && /^\*\*/.test(line) && !line.includes('グルメ')) inGourmet = false;
    if (inGourmet && /^\d+\./.test(line)) {
      const m = line.match(/^(\d+\.\s+)(.+?)（(.+?)）(.*)$/);
      if (m) {
        const shop = m[2].trim();
        const loc  = m[3].trim();
        return `${line} [GMAP:${shop}|${loc}]`;
      }
    }
    return line;
  }).join('\n');
}

// ─── スポット名の抽出 ────────────────────────────────────────
// 「1. スポット名」「2. 店名 — ジャンル」形式の行からスポット名を取り出す
function extractSpotNames(text) {
  const matches = [...text.matchAll(/^\d+\.\s+\*{0,2}([^*\n\r]+?)\*{0,2}(?:\s*[—–\-｜].*)?$/gm)];
  const names = [...new Set(
    matches
      .map(m => m[1]
        .replace(/（[^）]*）/g, '')   // 全角括弧の補足情報を除去
        .replace(/\([^)]*\)/g, '')    // 半角括弧の補足情報を除去
        .trim()
      )
      .filter(name => name.length >= 2 && name.length <= 40)
  )];
  console.log('[extract] spot names:', names);
  return names;
}

// ─── 地域ヒントの構築 ────────────────────────────────────────
// Nominatim は「スポット名 熊本県」のような形式が最も精度が高い
// 「九州」を付けると誤マッチするため使わない
function buildRegionHint(cond) {
  if (!cond) return '';

  const areaToKen = {
    '阿蘇・九重': '熊本県',
    '天草・島原': '熊本県',
    '由布院・別府': '大分県',
    '指宿・霧島': '鹿児島県',
    '大隅・佐多岬（九州最南端）': '鹿児島県',
    '雲仙・長崎市内': '長崎県',
    '高千穂・延岡': '宮崎県',
    '宮崎市・日南': '宮崎県',
    '糸島・唐津': '福岡県'
  };
  const departureToKen = {
    '福岡': '福岡県', '佐賀': '佐賀県', '長崎': '長崎県',
    '熊本': '熊本県', '大分': '大分県', '宮崎': '宮崎県', '鹿児島': '鹿児島県'
  };

  if (Array.isArray(cond.destination) && cond.destination.length) {
    const ken = areaToKen[cond.destination[0]];
    if (ken) return ken;
  }
  if (cond.departure && departureToKen[cond.departure]) {
    return departureToKen[cond.departure];
  }
  return '';
}

// ─── Nominatim ジオコーディング ──────────────────────────────
async function geocodeSpots(names, regionHint) {
  const spots = [];
  for (const name of names) {
    const q = regionHint ? `${name} ${regionHint}` : name;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
    console.log(`[geocode] query: "${q}"`);
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'kyushu-touring-chat/1.0 (https://github.com/maclarensennaevo-jpg/kyushu-touring-chat)'
        }
      });
      const data = await r.json();
      if (Array.isArray(data) && data.length > 0) {
        spots.push({ name, lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) });
        console.log(`[geocode] OK: "${name}" → ${data[0].lat}, ${data[0].lon} (${data[0].display_name})`);
      } else {
        console.log(`[geocode] not found: "${name}"`);
      }
    } catch (e) {
      console.error(`[geocode] error: "${name}"`, e.message);
    }
    // Nominatim 利用規約: 1秒以上の間隔を空ける
    await new Promise(r => setTimeout(r, 1100));
  }
  console.log(`[geocode] result: ${spots.length}/${names.length} spots found`);
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
1. 店名（市区町村名） — 料理ジャンル｜一言コメント
2. 店名（市区町村名） — 料理ジャンル｜一言コメント
※店名の直後の（）内に市区町村名を必ず記載してください。例：くろかわ荘（小国町）
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
