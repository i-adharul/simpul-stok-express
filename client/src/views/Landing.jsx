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

// S24 Landing page. All sections live in components/landing.
export default function Landing() {
  return (
    <>
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
