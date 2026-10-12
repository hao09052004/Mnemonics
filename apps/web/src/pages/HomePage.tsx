import { useEffect } from 'react';
import { Hero } from '../components/marketing/Hero';
import { CaptureSection } from '../components/marketing/CaptureSection';
import { CaptureFlowSection } from '../components/marketing/CaptureFlowSection';
import { MemoryMasonry } from '../components/marketing/MemoryMasonry';
import { AIPipelineSection } from '../components/marketing/AIPipelineSection';
import { SemanticSearchDemo } from '../components/marketing/SemanticSearchDemo';
import { RelatedMemoriesDemo } from '../components/marketing/RelatedMemoriesDemo';
import { SyncSection } from '../components/marketing/SyncSection';
import { PrivacySection } from '../components/marketing/PrivacySection';
import { ExtensionCTA } from '../components/marketing/ExtensionCTA';

export function HomePage() {
  useEffect(() => {
    document.title = 'Mnemonics — Your AI Second Brain';
    setMeta('description', 'Save pages, notes, images and highlights and find them later by meaning with Mnemonics.');
    setOg('og:title', 'Mnemonics — Your AI Second Brain');
    setOg('og:description', 'Save once. Remember anytime. A personal second brain for the browser-first generation.');
    setOg('og:type', 'website');
    setMeta('twitter:card', 'summary_large_image');
  }, []);

  return (
    <>
      <Hero />
      <CaptureSection />
      <CaptureFlowSection />
      <MemoryMasonry />
      <AIPipelineSection />
      <SemanticSearchDemo />
      <RelatedMemoriesDemo />
      <SyncSection />
      <PrivacySection />
      <ExtensionCTA />
    </>
  );
}

function setMeta(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setOg(property: string, content: string) {
  let el = document.querySelector(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('property', property);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}
