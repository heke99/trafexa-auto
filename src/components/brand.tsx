import Link from 'next/link';

export function Brand({ light = false, href = '/' }: { light?: boolean; href?: string }) {
  return <Link href={href} className={`brand${light ? ' brand-light' : ''}`} aria-label="Trafexa, till startsidan"><svg width="29" height="31" viewBox="0 0 29 31" fill="none" aria-hidden="true"><path d="M2 3H27V9H17V28H11V9H2V3Z" fill="currentColor"/><path d="M21 14H27V20H21V14Z" fill="currentColor" opacity=".5"/></svg><span>trafexa<span className="brand-period">.</span></span></Link>;
}
