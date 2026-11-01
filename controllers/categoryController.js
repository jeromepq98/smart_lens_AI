import * as categoryModel from '../models/category.js';

export async function listCategories(req, res) {
  const rows = await categoryModel.listActive();
  res.json({
    data: rows.map((row) => ({
      id: Number(row.id),
      slug: row.slug,
      name: { en: row.name_en, fil: row.name_fil, ceb: row.name_ceb },
      icon: row.icon,
      sortOrder: Number(row.sort_order),
    })),
  });
}
