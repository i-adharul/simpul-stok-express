import { GENERIC_ERROR, errorText } from './apiError'

// The text P11 shows for a failed POST /api/stock/transfers. `items` are the rows being sent, so the product
// named by `details.productId` (INSUFFICIENT_STOCK) can be shown by name. A 5xx never shows server text.
export function transferErrorMessage(error, items) {
  const { response } = error
  if (!response) return `${errorText(error)} Anda boleh mencoba lagi; mutasi tidak akan tercatat dua kali.`
  if (response.status === 409 && response.data?.code === 'INSUFFICIENT_STOCK') {
    const item = items.find((i) => i.productId === response.data.details?.productId)
    return `Stok ${item ? item.name : 'salah satu produk'} di gudang asal tidak mencukupi. Tidak ada stok yang dipindahkan. Periksa jumlahnya lagi.`
  }
  return errorText(error) ?? GENERIC_ERROR
}

// Which product the refusal is about, or null.
export const insufficientProductId = (error) =>
  error.response?.status === 409 && error.response.data?.code === 'INSUFFICIENT_STOCK' ? (error.response.data.details?.productId ?? null) : null
