import ErrorPage, { DashboardButton } from '../components/ErrorPage'

// S23, 403. The server decides who may do what; this page only explains the answer.
export default function Forbidden() {
  return (
    <ErrorPage
      status={403}
      icon="shield_lock"
      title="Anda tidak punya akses ke halaman ini"
      message="Hubungi Owner organisasi Anda jika Anda membutuhkan akses."
    >
      <DashboardButton />
    </ErrorPage>
  )
}
