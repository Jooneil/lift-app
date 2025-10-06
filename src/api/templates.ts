import { supabase } from '../supabaseClient'

export async function listTemplates() {
  const { data, error } = await supabase
    .from('templates')
    .select('id,name,data')
    .order('id', { ascending: false })
  if (error) throw error
  return data ?? []
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
