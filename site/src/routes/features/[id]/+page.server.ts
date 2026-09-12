import { features, details } from '$lib/server/catalog';
import { error } from '@sveltejs/kit';
export function entries() { return features.map(feature => ({ id: feature.id })); }
export function load({ params }: { params: { id: string } }) { const feature = features.find(f => f.id === params.id); if (!feature) error(404, 'Feature not found'); return { feature, detail: details[feature.id] }; }
