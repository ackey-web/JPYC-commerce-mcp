/**
 * タスク分析モジュール
 * - スキル別重み付け
 * - Claude APIによるタスク複雑度分析
 */
import Anthropic from '@anthropic-ai/sdk';

// スキルカテゴリ別の重み（希少性・難易度を反映）
const SKILL_WEIGHTS = {
  // Blockchain / Web3（高難易度・希少）
  solidity: 0.25,
  'smart contract': 0.25,
  'smart contracts': 0.25,
  ethereum: 0.20,
  polygon: 0.20,
  web3: 0.20,
  'defi': 0.25,
  hardhat: 0.18,
  foundry: 0.18,
  vyper: 0.25,
  rust: 0.22,
  'zero knowledge': 0.30,
  zk: 0.30,

  // AI / ML（高難易度）
  tensorflow: 0.22,
  pytorch: 0.22,
  'machine learning': 0.22,
  'deep learning': 0.25,
  nlp: 0.22,
  'computer vision': 0.22,
  opencv: 0.18,

  // バックエンド（中難易度）
  'node.js': 0.12,
  nodejs: 0.12,
  python: 0.12,
  go: 0.15,
  java: 0.12,
  typescript: 0.12,
  postgresql: 0.12,
  redis: 0.12,
  graphql: 0.14,
  grpc: 0.15,

  // フロントエンド（標準）
  react: 0.10,
  vue: 0.10,
  angular: 0.10,
  nextjs: 0.12,
  'next.js': 0.12,
  css: 0.08,
  html: 0.06,
  javascript: 0.08,

  // インフラ / DevOps
  docker: 0.12,
  kubernetes: 0.18,
  aws: 0.14,
  gcp: 0.14,
  terraform: 0.16,
  ci: 0.10,
  cd: 0.10,
};

const DEFAULT_SKILL_WEIGHT = 0.12;

/**
 * スキルリストから重み付きスコアを算出
 * @param {string[]} skills
 * @returns {{ weightedScore: number, breakdown: Object[] }}
 */
export function calculateSkillScore(skills) {
  const breakdown = skills.map((skill) => {
    const normalized = skill.toLowerCase().trim();
    const weight = SKILL_WEIGHTS[normalized] ?? DEFAULT_SKILL_WEIGHT;
    return { skill, weight };
  });

  // 重み合計（上限 0.75）
  const rawScore = breakdown.reduce((sum, s) => sum + s.weight, 0);
  const weightedScore = Math.min(rawScore, 0.75);

  return { weightedScore, breakdown };
}

/**
 * Claude APIでタスクの複雑度を分析する
 * @param {string} description - タスク説明文
 * @param {string[]} required_skills - 必要スキル
 * @returns {Promise<{ complexity: number, estimated_hours: number, rationale: string }>}
 */
export async function analyzeTaskComplexity(description, required_skills) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // APIキー未設定時はフォールバック（AI分析なし）
    return null;
  }

  const client = new Anthropic();

  const prompt = `あなたはソフトウェア開発タスクの査定エキスパートです。
以下のタスクを分析して、JSON形式で回答してください。

## タスク説明
${description}

## 必要スキル
${required_skills.join(', ')}

## 回答形式（JSONのみ出力）
{
  "complexity": 0.0〜1.0の数値（0.1=trivial, 0.3=簡単, 0.5=標準, 0.7=難しい, 0.9=非常に複雑）,
  "estimated_hours": 推定工数（時間）,
  "risk_factors": ["リスク要因1", "リスク要因2"],
  "rationale": "査定根拠の1行要約"
}

## 判断基準
- 既存システムへの変更は新規より複雑
- セキュリティに関わるタスクは複雑度を高めに
- AI/ML・ブロックチェーンは一般的なWeb開発より高めに
- スキルの組み合わせが多いほど統合の複雑さが増す`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].text;
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[1]);
    return {
      complexity: Math.min(Math.max(result.complexity || 0.5, 0), 1),
      estimated_hours: result.estimated_hours || 0,
      risk_factors: result.risk_factors || [],
      rationale: result.rationale || '',
    };
  } catch (err) {
    console.error('[taskAnalyzer] AI分析失敗（フォールバック）:', err.message);
    return null;
  }
}
