export function nav(path, params) {
  location.hash = path + (params ? '?' + new URLSearchParams(params) : '')
}
