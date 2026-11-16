import './legal-notice.css';

export default function LegalNotice({text}:{text:string}) {
  const paragraphs=text.trim().split(/\r?\n\s*\r?\n/).map(paragraph=>paragraph.trim());
  return <main className="account-main legal-notice-page">
    <a className="button quiet legal-notice-back" href="/account">Back to account profile</a>
    <article className="panel legal-notice-content">
      {paragraphs.map((paragraph,i)=>paragraph.startsWith('# ')
        ?<h1 key={i}>{paragraph.slice(2)}</h1>
        :paragraph.startsWith('## ')
          ?<h2 key={i}>{paragraph.slice(3)}</h2>
          :<p key={i}>{paragraph}</p>)}
    </article>
  </main>;
}
