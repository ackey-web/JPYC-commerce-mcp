/**
 * evaluate_task 精度改善テスト
 * AI分析あり/なしでの出力を比較
 */
import dotenv from 'dotenv';
dotenv.config({ path: '../.env.local' });

import evaluateTask from './tools/evaluateTask.js';

const testCases = [
  {
    name: 'ブロックチェーン + AI（高難易度）',
    args: {
      description: 'ScanTarotにカード自動判定精度向上機能を追加。TensorFlowで画像認識モデルを再トレーニングし、Solidityのスマートコントラクトと連携してNFTメタデータを自動更新する。',
      required_skills: ['Solidity', 'TensorFlow', 'Python', 'React', 'OpenCV'],
      deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    },
  },
  {
    name: 'フロントエンドのみ（低〜中難易度）',
    args: {
      description: 'ランディングページのレスポンシブ対応とダークモード追加。既存のデザインシステムに沿って実装。',
      required_skills: ['React', 'CSS', 'TypeScript'],
      deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
  },
  {
    name: 'セキュリティ監査（高難易度・短期限）',
    args: {
      description: 'DeFiプロトコルのスマートコントラクトセキュリティ監査。再入攻撃、フラッシュローン攻撃、権限昇格の脆弱性を調査し、修正パッチを提供する。',
      required_skills: ['Solidity', 'DeFi', 'Smart Contracts', 'Foundry'],
      deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
  },
];

async function run() {
  console.log('=== evaluate_task 精度改善テスト ===\n');

  for (const tc of testCases) {
    console.log(`--- ${tc.name} ---`);
    try {
      const result = await evaluateTask(tc.args);
      console.log(`  scoring_method: ${result.scoring_method}`);
      console.log(`  difficulty_score: ${result.difficulty_score}`);
      console.log(`  reward: ${result.recommended_reward_min}〜${result.recommended_reward_max} JPYC`);
      console.log(`  skills:`, result.skill_breakdown.map(s => `${s.skill}(${s.weight})`).join(', '));
      if (result.ai_analysis) {
        console.log(`  AI complexity: ${result.ai_analysis.complexity}`);
        console.log(`  AI hours: ${result.ai_analysis.estimated_hours}h`);
        console.log(`  AI rationale: ${result.ai_analysis.rationale}`);
        if (result.ai_analysis.risk_factors.length > 0) {
          console.log(`  AI risks: ${result.ai_analysis.risk_factors.join(', ')}`);
        }
      }
    } catch (err) {
      console.log(`  エラー: ${err.message}`);
    }
    console.log();
  }
}

run().catch(console.error);
