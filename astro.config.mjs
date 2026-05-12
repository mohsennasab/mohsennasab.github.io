// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // The canonical URL of the production site. Used for RSS and absolute URLs
  // in <head> meta tags. Change if you move off this domain.
  site: 'https://hydromohsen.com',

  // Integrations to add in the content phase: @astrojs/sitemap, @astrojs/rss,
  // @astrojs/mdx (for the blog), a lightbox for the photo gallery.
  integrations: [],

  // Astro defaults to building static HTML — perfect for GitHub Pages.
  // Files placed in /public are copied verbatim to the site root, so any
  // standalone HTML page or app you drop in there is served as-is.
});
