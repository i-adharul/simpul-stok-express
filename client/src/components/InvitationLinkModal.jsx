import { useState } from 'react'
import { ROLE_LABELS } from '../constants/navigation'

const TEXTS = {
  invitation: { title: 'Undangan dibuat', intro: 'Tautan undangan telah siap untuk', linkLabel: 'Tautan undangan' },
  reset: { title: 'Tautan reset dibuat', intro: 'Tautan reset password telah siap untuk', linkLabel: 'Tautan reset' },
}

// P08. `kind` is "invitation" (after P07) or "reset" (reused by the reset-link action in E7-09). `path` is
// "/invite/<token>" or "/reset/<token>". The raw token is only in the API answer that created it, so closing
// this popup is the last time the link can be copied.
export default function InvitationLinkModal({ kind = 'invitation', path, email, role, onClose }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const text = TEXTS[kind]
  const link = `${window.location.origin}${path}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setCopyFailed(false)
    } catch {
      // Clipboard blocked (insecure page or no permission): the field stays selectable for a manual copy.
      setCopyFailed(true)
    }
  }

  return (
    <dialog className="modal modal-open" aria-modal="true" aria-labelledby="link-title">
      <div className="modal-box max-w-md space-y-4">
        <div>
          <h2 id="link-title" className="text-lg font-semibold">
            {text.title}
          </h2>
          <p className="text-sm text-base-content/70">
            {text.intro} <strong>{email}</strong>
            {role && (
              <>
                {' '}dengan peran <strong>{ROLE_LABELS[role] ?? role}</strong>
              </>
            )}
            .
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="link-value" className="text-sm font-semibold">
            {text.linkLabel}
          </label>
          <div className="join w-full">
            <input id="link-value" readOnly className="input join-item w-full" value={link} onFocus={(event) => event.target.select()} />
            <button type="button" className="btn btn-primary join-item" onClick={copy}>
              {copied ? 'Tersalin' : 'Salin tautan'}
            </button>
          </div>
          {copyFailed && <p role="alert" className="text-sm font-medium text-error">Tidak dapat menyalin otomatis. Pilih teks tautan lalu salin manual.</p>}
        </div>
        <p className="alert alert-info alert-soft text-sm">Tautan hanya ditampilkan sekali. Kirimkan ke calon anggota.</p>
        <div className="modal-action">
          <button type="button" className="btn" onClick={onClose}>
            Selesai
          </button>
        </div>
      </div>
    </dialog>
  )
}
