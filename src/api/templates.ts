import { supabase } from '../supabaseClient'

export async function listTemplates() {
  const res = await supabase
    .from('templates')
    .select('id,name,data')
    .order('id', { ascending: false })
  if (res.error) {
    // If table doesn't exist yet, return empty list instead of crashing UI
    const code = (res.error as { code?: string }).code
    if (code === '42P01' || res.error.message.includes('not found')) return []
    throw res.error
  }
  return res.data ?? []
}

export async function createTemplate(name: string, data: Record<string, unknown> = {}) {
  const { data: row, error } = await supabase
    .from('templates')
    .insert([{ name, data }])
    .select('id,name,data')
    .single()
  if (error) throw error
  return row
}
