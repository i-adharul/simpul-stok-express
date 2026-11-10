import { DEMO_ROLES, useDemoSignIn } from '../../utils/useDemoSignIn'
import { Icon, SectionHeading } from './parts'

// "Coba sebagai...": one card per demo role. The sign-in, loading state and error text are the same
// as the S01 panel (useDemoSignIn).
export default function DemoSection() {
  const { pending, error, signIn } = useDemoSignIn()

  return (
    <section id="demo" aria-labelledby="demo-judul" className="scroll-mt-16 border-t border-base-300 bg-base-100/50 py-16 sm:py-20">
      <div className="mx-auto max-w-300 px-4 sm:px-6">
        <SectionHeading
          id="demo-judul"
          center
          title="Coba sebagai..."
          text="Jelajahi Simpul Stok dari sudut pandang satu peran. Tidak perlu daftar atau password."
        />
        <div className="grid gap-6 md:grid-cols-3">
          {DEMO_ROLES.map((item, index) => (
            <div key={item.role} className="flex flex-col justify-between rounded-box border border-base-300 bg-base-100 p-6 transition-colors hover:border-primary">
              <div>
                <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-base-200 text-primary">
                  <Icon name={item.icon} className="text-[24px]" />
                </span>
                <h3 className="mb-2 text-lg font-semibold">{item.label}</h3>
                <p className="mb-6 text-sm leading-relaxed text-base-content/70">{item.text}</p>
              </div>
              <button
                type="button"
                className={`btn w-full ${index === 0 ? 'btn-primary' : 'btn-outline border-base-300'}`}
                disabled={Boolean(pending)}
                onClick={() => signIn(item.role)}
              >
                {pending === item.role ? 'Masuk...' : `Masuk sebagai ${item.label}`}
              </button>
            </div>
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-6 text-center text-sm font-medium text-error">
            {error}
          </p>
        )}
        <div className="mx-auto mt-6 max-w-2xl rounded-box border border-info/30 bg-info/10 p-3 text-center text-sm">
          <p className="text-base-content/70">
            Buka jendela incognito untuk mencoba dua peran sekaligus. Data demo bersifat publik dan direset berkala, jadi jangan memasukkan data pribadi.
          </p>
        </div>
      </div>
    </section>
  )
}
