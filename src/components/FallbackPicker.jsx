export default function FallbackPicker({ label, className, onFiles }) {
  return (
    <label className={className}>
      {label}
      <input
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        hidden
        onChange={(e) => e.target.files.length && onFiles(e.target.files)}
      />
    </label>
  )
}
