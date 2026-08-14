import sys
import NXOpen
import NXOpen.UF

def safe_print(msg):
    try:
        sys.stdout.buffer.write((str(msg) + "\n").encode("utf-8", errors="replace"))
        sys.stdout.buffer.flush()
    except:
        pass

def main():
    theSession = NXOpen.Session.GetSession()
    ufSession = NXOpen.UF.UFSession.GetUFSession()

    path = r"d:\Programms\obsidian-cad\test-vault\1 часть кондуктора.prt"
    part = theSession.Parts.OpenBaseDisplay(path)
    if isinstance(part, tuple):
        part = part[0]

    body = list(part.Bodies)[0]
    safe_print(f"Testing body: {body.Name}, Tag: {body.Tag}")

    facet_params = ufSession.Facet.AskDefaultParameters()
    facet_params.SurfaceAngularTolerance = 0.2
    facet_params.SurfaceDistTolerance = 0.05
    facet_params.SpecifySurfaceTolerance = True
    facet_params.SpecifyParameters = True

    model_tag = ufSession.Facet.FacetSolid(body.Tag, facet_params)
    num_facets = ufSession.Facet.AskNFacetsInModel(model_tag)
    safe_print(f"FacetSolid model_tag: {model_tag}, Facets count: {num_facets}")

    facet_id = -1
    verts_collected = 0
    facets_counted = 0
    all_positions = []
    all_normals = []
    all_indices = []

    while True:
        facet_id = ufSession.Facet.CycleFacets(model_tag, facet_id)
        if facet_id == -1:
            break
        num_verts, vertices = ufSession.Facet.AskVerticesOfFacet(model_tag, facet_id)
        num_norms, normals = ufSession.Facet.AskNormalsOfFacet(model_tag, facet_id)

        base_idx = len(all_positions) // 3
        for v in range(num_verts):
            all_positions.extend([float(vertices[v][0]), float(vertices[v][1]), float(vertices[v][2])])
            if num_norms > v:
                all_normals.extend([float(normals[v][0]), float(normals[v][1]), float(normals[v][2])])
            elif num_norms > 0:
                all_normals.extend([float(normals[0][0]), float(normals[0][1]), float(normals[0][2])])
            else:
                all_normals.extend([0.0, 1.0, 0.0])

        for v in range(1, num_verts - 1):
            all_indices.extend([base_idx, base_idx + v, base_idx + v + 1])

        facets_counted += 1
        verts_collected += num_verts

    safe_print(f"SUCCESS! Cycled {facets_counted} facets, generated {len(all_positions)//3} vertices, {len(all_indices)//3} triangles!")

    # Min/Max
    xs = all_positions[0::3]
    ys = all_positions[1::3]
    zs = all_positions[2::3]
    safe_print(f"Bounds X: [{min(xs):.2f}, {max(xs):.2f}], Y: [{min(ys):.2f}, {max(ys):.2f}], Z: [{min(zs):.2f}, {max(zs):.2f}]")

if __name__ == "__main__":
    main()
