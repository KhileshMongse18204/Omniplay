import { Directory } from '../components/Directory';
import { Hero } from '../components/Hero';

// "/" and "/c/:slug" render this same component, so switching category keeps the page mounted:
// no scroll jump, no hero re-animation, only the grid swaps.
export default function Home({ params }: { params?: { slug?: string } }) {
  return (
    <>
      <Hero />
      <Directory slug={params?.slug} />
    </>
  );
}
