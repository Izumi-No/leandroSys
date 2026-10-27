import { PageHeader } from '@/components/common/feedback';
import { AdicionaisPanel } from '@/components/admin/catalogo/adicionais';
import { CategoriasPanel } from '@/components/admin/catalogo/categorias';
import { ProdutosPanel } from '@/components/admin/catalogo/produtos';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/** Cadastro do cardápio: categorias, produtos e adicionais. */
export function AdminCatalogoPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        titulo="Cardápio"
        descricao="Categorias, produtos e adicionais usados nas comandas."
      />

      <Tabs defaultValue="categorias">
        <TabsList>
          <TabsTrigger value="categorias">Categorias</TabsTrigger>
          <TabsTrigger value="produtos">Produtos</TabsTrigger>
          <TabsTrigger value="adicionais">Adicionais</TabsTrigger>
        </TabsList>
        <TabsContent value="categorias" className="mt-4">
          <CategoriasPanel />
        </TabsContent>
        <TabsContent value="produtos" className="mt-4">
          <ProdutosPanel />
        </TabsContent>
        <TabsContent value="adicionais" className="mt-4">
          <AdicionaisPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
