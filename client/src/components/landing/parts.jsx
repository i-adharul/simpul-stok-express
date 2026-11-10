// Small pieces shared by the landing sections (S24).
export function Icon({ name, className = '' }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  )
}

// A real screenshot of the app with the demo data (client/public/landing). The width and height
// reserve the space so the page does not jump while the image loads.
const SHOTS = {
  dashboard: { src: '/landing/dashboard.jpg', width: 1400, height: 1045 },
  riwayat: { src: '/landing/riwayat.jpg', width: 1400, height: 832 },
  mutasi: { src: '/landing/mutasi.jpg', width: 1400, height: 975 },
}

export function Shot({ name, alt, eager = false, className = '' }) {
  const shot = SHOTS[name]
  return (
    <img
      src={shot.src}
      width={shot.width}
      height={shot.height}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className={`block w-full ${className}`}
    />
  )
}

export function SectionHeading({ id, eyebrow, title, text, center = false, dark = false }) {
  return (
    <div className={`mb-10 max-w-2xl sm:mb-14 ${center ? 'mx-auto text-center' : ''}`}>
      {eyebrow && <p className={`mb-2 text-xs font-semibold uppercase tracking-wider ${dark ? 'text-[#a594fd]' : 'text-primary'}`}>{eyebrow}</p>}
      <h2 id={id} className={`mb-3 text-2xl font-bold tracking-tight sm:text-3xl ${dark ? 'text-white' : ''}`}>{title}</h2>
      {text && <p className={`text-base ${dark ? 'text-stone-400' : 'text-base-content/70'}`}>{text}</p>}
    </div>
  )
}
