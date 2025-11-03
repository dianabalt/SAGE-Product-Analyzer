// web/pages/api/ai-grade.ts
import type { NextApiRequest, NextApiResponse } from 'next';

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // put this in .env.local (server only)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { ingredients, title } = req.body ?? {};
    if (!ingredients || typeof ingredients !== 'string') {
      return res.status(200).json({ grade: null, issues: [], analysis: null });
    }

    if (!OPENAI_API_KEY) {
      // Fallback so devs can still test without a key
      return res.status(200).json({
        grade: 'C',
        issues: ['Dev mode (no AI key)'],
        analysis: { source: 'dev-fallback', title, sample: true }
      });
    }

    // You can swap this for DeepSeek/OpenAI-compatible libs; using raw fetch keeps deps minimal.
    const prompt = [
      `You are a cosmetic safety analyst.`,
      `Given an INCI-style or freeform ingredient list, return a strict JSON object with:`,
      `  grade: string in {A,B,C,D,F}`,
      `  issues: array of short strings (e.g., "Parabens", "Fragrance", "Drying alcohol", "Retinoids" etc.)`,
      `  perIngredient: array of { name, risk: "low"|"medium"|"high", notes }`,
      `  suggestions: array of safer alternatives or what to avoid`,
      `Consider context: sunscreen filters, fragrances, parabens, alcohol denat, beneficials (niacinamide, hyaluronic acid).`,
      `Keep output strictly valid JSON.`,
      ``,
      `Title: ${title ?? ''}`,
      `Ingredients: ${ingredients}`
    ].join('\n');

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
    });

    const json = await r.json();
    const text = json?.choices?.[0]?.message?.content ?? '';
    // Attempt to parse JSON from the model’s response safely:
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const parsed = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;

    const grade = parsed?.grade ?? null;
    const issues = Array.isArray(parsed?.issues) ? parsed.issues : [];
    const analysis = parsed ?? null;

    return res.status(200).json({ grade, issues, analysis });
  } catch (e) {
    return res.status(200).json({ grade: null, issues: [], analysis: null });
  }
}
