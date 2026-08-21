export const el = (selector) => document.querySelector(selector);
export const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
export const button = (label, action, tone = 'primary') => `<button class="button ${tone}" data-action="${action}">${label}</button>`;
