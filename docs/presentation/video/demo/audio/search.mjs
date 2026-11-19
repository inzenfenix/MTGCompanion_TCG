// search.mjs "<mood>" — list a few HeyGen catalog music results (title, length, score), no download
import { heygenAuthHeaders, searchSounds } from '/home/inzenfenix/.claude/plugins/marketplaces/hyperframes/skills/media-use/audio/scripts/lib/heygen.mjs';
const r = await searchSounds(process.argv[2], 'music', heygenAuthHeaders(), { limit: 6 });
for (const x of r) console.log(JSON.stringify({ id: x.id, name: x.name ?? x.title, dur: x.duration, score: x.score, tags: x.tags ?? x.moods, url: x.audio_url?.slice(0, 60) }));
