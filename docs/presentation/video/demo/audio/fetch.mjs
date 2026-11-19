// fetch.mjs "<mood>" <id>... — download the catalog tracks with those ids to ./<id>.mp3
import { heygenAuthHeaders, searchSounds, downloadTo } from '/home/inzenfenix/.claude/plugins/marketplaces/hyperframes/skills/media-use/audio/scripts/lib/heygen.mjs';
const [q, ...ids] = process.argv.slice(2);
const r = await searchSounds(q, 'music', heygenAuthHeaders(), { limit: 10 });
for (const x of r) if (ids.includes(x.id.slice(0, 8))) { await downloadTo(x.audio_url, `${process.cwd()}/${x.id.slice(0, 8)}.mp3`); console.log('got', x.id.slice(0, 8)); }
