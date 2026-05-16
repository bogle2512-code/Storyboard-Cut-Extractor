export function safeName(value: string, fallback = 'storyboard-project') {
  return (value || fallback).trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_') || fallback;
}

export function removeImageExtension(value: string) {
  return value.replace(/\.(png|jpe?g|webp)$/i, '');
}
