import BehindTheScenes from '../components/landing/BehindTheScenes'
import DemoSection from '../components/landing/DemoSection'
import Faq from '../components/landing/Faq'
import FinalCta from '../components/landing/FinalCta'
import Footer from '../components/landing/Footer'
import Features from '../components/landing/Features'
import Hero from '../components/landing/Hero'
import HowItWorks from '../components/landing/HowItWorks'
import Pricing from '../components/landing/Pricing'
import ProofStrip from '../components/landing/ProofStrip'
import Problem from '../components/landing/Problem'

const TITLE = 'Simpul Stok: stok multi-gudang tanpa stok minus'
const DESCRIPTION =
  'Simpul Stok mencatat, memindahkan, dan menelusuri stok antar gudang. Stok tidak pernah minus, mutasi utuh atau batal, kirim ulang tidak menggandakan, data tiap organisasi terpisah. Coba demo tanpa daftar.'

// S24 Landing page. All sections live in components/landing. React 19 moves <title> and <meta>
// to <head>, so the page has its own title while it is shown.
export default function Landing() {
  return (
    <>
      <title>{TITLE}</title>
      <meta name="description" content={DESCRIPTION} />
      <meta property="og:title" content={TITLE} />
      <meta property="og:description" content={DESCRIPTION} />
      <meta property="og:type" content="website" />
      <Hero />
      <ProofStrip />
      <Problem />
      <Features />
      <HowItWorks />
      <DemoSection />
      <BehindTheScenes />
      <Pricing />
      <Faq />
      <FinalCta />
      <Footer />
    </>
  )
}
