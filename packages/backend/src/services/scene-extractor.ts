import OpenAI from 'openai';
import type { SceneDefinition } from '@picture-book/shared';
import type { StoryResult } from './story-engine.js';
import { createOpenAIClient } from '../lib/openai.js';

export interface ExtractScenesInput {
  story: StoryResult;
}

export interface ExtractScenesResult {
  scenes: SceneDefinition[];
  pageSceneMapping: Record<number, string>;
}

function buildScenePrompt(input: ExtractScenesInput): string {
  const storyText = input.story.pages
    .map((p) => `Page ${p.pageNumber}: "${p.text}"`)
    .join('\n');

  return `You are a background artist and prop designer for a children's picture book.
Analyze the story below and:
1. Identify all unique locations/scenes. For pages that share the same location, assign the same scene ID.
2. Identify KEY PROPS — important objects that appear across multiple pages (stuffed animals, toys, tools, bags, etc.) and define their appearance in detail so they look the same on every page.

STORY:
${storyText}

For each unique scene, provide:
- sceneId: a short snake_case identifier
- locationName: descriptive name in English
- keyElements: specific objects, furniture, plants, buildings that define this location
- colorPalette: dominant colors for this scene
- lighting: lighting conditions
- atmosphere: mood and feeling
- keyProps: detailed description of important objects/items that appear in this scene AND must look consistent across pages (e.g., "a small brown teddy bear with a red bow tie, round black button eyes, and slightly worn fur"). If no key props, use empty string.

Also provide a mapping of each page number to its scene ID.

IMPORTANT:
- If the same location appears on multiple pages, use the SAME sceneId
- KEY PROPS that appear across multiple scenes should be described IDENTICALLY in each scene's keyProps field
- For stuffed animals, toys, or important objects: describe their exact shape, color, size, material, and distinguishing features
- Descriptions must be in English
- Be specific enough for an illustrator to draw the same background and props consistently
- Keep settings realistic and everyday (no fantasy elements unless the story requires it)

Output as JSON:
{
  "scenes": [
    {
      "sceneId": "school_playground",
      "locationName": "School playground",
      "keyElements": "...",
      "colorPalette": "...",
      "lighting": "...",
      "atmosphere": "...",
      "keyProps": "a small brown teddy bear with a red bow tie and round black button eyes"
    }
  ],
  "pageSceneMapping": {
    "1": "school_playground",
    "2": "classroom",
    "3": "school_playground"
  }
}`;
}

function parseScenesResponse(
  content: string,
  pageNumbers: number[]
): ExtractScenesResult {
  const parsed = JSON.parse(content);

  const scenes: SceneDefinition[] = [];
  const rawScenes: unknown[] = Array.isArray(parsed.scenes) ? parsed.scenes : [];

  for (const raw of rawScenes) {
    if (typeof raw !== 'object' || raw === null) continue;
    const s = raw as Record<string, unknown>;

    const scene: SceneDefinition = {
      sceneId: typeof s.sceneId === 'string' && s.sceneId ? s.sceneId : '',
      locationName: typeof s.locationName === 'string' && s.locationName ? s.locationName : '',
      keyElements: typeof s.keyElements === 'string' && s.keyElements ? s.keyElements : '',
      colorPalette: typeof s.colorPalette === 'string' && s.colorPalette ? s.colorPalette : '',
      lighting: typeof s.lighting === 'string' && s.lighting ? s.lighting : '',
      atmosphere: typeof s.atmosphere === 'string' && s.atmosphere ? s.atmosphere : '',
      keyProps: typeof s.keyProps === 'string' ? s.keyProps : '',
    };

    if (scene.sceneId) {
      scenes.push(scene);
    }
  }

  const pageSceneMapping: Record<number, string> = {};
  const rawMapping =
    typeof parsed.pageSceneMapping === 'object' && parsed.pageSceneMapping !== null
      ? (parsed.pageSceneMapping as Record<string, unknown>)
      : {};

  const validSceneIds = new Set(scenes.map((s) => s.sceneId));

  for (const pageNum of pageNumbers) {
    const mappedId = rawMapping[String(pageNum)];
    if (typeof mappedId === 'string' && validSceneIds.has(mappedId)) {
      pageSceneMapping[pageNum] = mappedId;
    }
  }

  return { scenes, pageSceneMapping };
}

/**
 * ストーリーテキストからシーンを抽出し、定義を生成する。
 * 同一の場所が複数ページに登場する場合、同一の SceneDefinition を共有する。
 * エラー時は空の scenes 配列と空の pageSceneMapping を返す（Graceful Degradation）。
 */
export async function extractScenes(
  input: ExtractScenesInput,
  openaiClient?: OpenAI
): Promise<ExtractScenesResult> {
  if (input.story.pages.length === 0) {
    return { scenes: [], pageSceneMapping: {} };
  }

  try {
    const client = openaiClient ?? createOpenAIClient();
    const prompt = buildScenePrompt(input);
    const pageNumbers = input.story.pages.map((p) => p.pageNumber);

    console.log(
      `[scene-extractor] Extracting scenes for ${input.story.pages.length} page(s)...`
    );

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are a background artist for a children\'s picture book. Analyze stories and generate detailed, consistent scene definitions in English. Always respond with valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error('[scene-extractor] Empty response from OpenAI API');
      return { scenes: [], pageSceneMapping: {} };
    }

    const result = parseScenesResponse(content, pageNumbers);
    console.log(
      `[scene-extractor] Extracted ${result.scenes.length} unique scene(s), mapped ${Object.keys(result.pageSceneMapping).length} page(s)`
    );
    return result;
  } catch (error) {
    console.error(
      '[scene-extractor] Failed to extract scenes:',
      error instanceof Error ? error.message : String(error)
    );
    return { scenes: [], pageSceneMapping: {} };
  }
}

// Exported for testing
export { buildScenePrompt, parseScenesResponse };
