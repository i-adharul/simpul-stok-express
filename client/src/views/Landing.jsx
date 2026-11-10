import BehindTheScenes from '../components/landing/BehindTheScenes'
import DemoSection from '../components/landing/DemoSection'
import Features from '../components/landing/Features'
import Hero from '../components/landing/Hero'
import HowItWorks from '../components/landing/HowItWorks'
import ProofStrip from '../components/landing/ProofStrip'
import Problem from '../components/landing/Problem'

// S24 Landing page. Pricing, FAQ and footer sections come in later steps.
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
    </>
  )
}
