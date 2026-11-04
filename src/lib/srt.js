export function toVtt(text, filename) {
  text = text.replace(/^﻿/, '').replace(/\r/g, '')
  if (filename.toLowerCase().endsWith('.vtt')) return text
  return 'WEBVTT\n\n' + text.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
}
