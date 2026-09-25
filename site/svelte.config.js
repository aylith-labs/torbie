import adapter from '@sveltejs/adapter-static';
const base = process.env.TORBIE_CUSTOM_DOMAIN === '1' ? '' : (process.env.BASE_PATH ?? '/torbie');
export default { kit: { adapter: adapter({ fallback: '404.html' }), paths: { base } } };
