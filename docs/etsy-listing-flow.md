# Etsy Listing Flow Notes

This note records the Etsy listing page steps that the browser plugin should perform.
The local helper still provides SKU data and local file upload support; AdsPower is only used as the logged-in browser environment while we test the page.

## Confirmed Data Source

- SKU data: `GET /api/product/:sku`
- File upload helper: `POST /api/upload-dialog`
- Test listing root: `C:\Users\ZhuanZ\Downloads\上架`

## Draft Listing Flow

1. Open Etsy shop manager listing creation page.
   - Observed URL: `/your/shops/me/listing-editor/create#media`
   - Existing listing edit URL: `/your/shops/me/listing-editor/edit/<listing_id>`
2. Upload listing photos.
   - Click the photo upload area/button.
   - Call `/api/upload-dialog` with `kind: "listing-images"` after the system file picker opens.
   - In AdsPower Firefox testing, JavaScript click was not reliable for the media upload button.
   - Use a real/native click on the visible `Upload` button, then paste file paths into the Windows `File Upload` dialog.
3. Upload listing video if required.
   - Click the video upload area/button.
   - Call `/api/upload-dialog` with `kind: "listing-video"` after the system file picker opens.
   - Photos and video can be submitted together from the media upload dialog.
4. Fill title from `product.title`.
5. Select category and digital/download product options.
6. Fill description from `product.description`.
7. Fill price and inventory fields.
8. Fill tags from `product.tags`, up to 13 tags.
   - Etsy tag input accepts comma-separated tags.
   - Each tag must be 20 characters or fewer.
   - Do not submit long Excel tags directly; shorten them before typing.
9. Select shop section if available.
10. Select craft types.
11. Upload digital download files.
    - Click the digital file upload area/button.
    - Call `/api/upload-dialog` with `kind: "download-files"` after the system file picker opens.
    - Keep original file basenames, such as `1A_003_seamless.jpg` and `1A_003_single.jpg`.
12. Verify the final edit page sections.
13. Stop before final publish unless explicitly testing save/publish.

## Create Page Observations

Observed new listing URL:

- `https://www.etsy.com/your/shops/me/listing-editor/create#media`

Important create-page behavior:

- The `Photo and video` section shows `Drag and drop files or Upload`.
- The photo upload input is present as a file input named `listing-media-upload`.
- The page defaults to `Physical item`.
- The plugin must switch `What type of item is it?` to `Digital files`.
- The category area shows top category choices:
  - `Patterns & Blueprints`
  - `Craft Supplies & Tools`
  - `Patterns & How To`
  - `Patterns & Blueprints`
- The selected target category should become:
  - `Patterns & Blueprints`
  - `Digital files`
- `When was it made?` appears after the item type/category area.
- `Digital files *` upload controls are not present until the listing is configured as digital.
- The bottom action buttons on the create page are:
  - `Cancel`
  - `Save as draft`
  - `Publish`

## 1A_003 Test Notes

Test SKU:

- `1A_003`

Confirmed completed fields:

- Media uploaded: page changed from `Drag and drop files or Upload` to `Add / Featured / Thumbnails`.
- Digital files uploaded:
  - `1A_003_seamless.jpg`
  - `1A_003_single.jpg`
- Tags: `All 13 used`.
- Craft type: `All 5 selected`.
- Product type: `Digital files`.
- How it's made:
  - `I did`
  - `A supply or tool to make things`
  - `With an AI generator`

Issues found during test:

- WebDriver direct file input upload failed in AdsPower Firefox with `File not found`, even for existing local paths.
- System file dialog upload worked after a native click opened the dialog.
- Clipboard writes can fail transiently; use retry logic.
- Temporary copied files can change visible download filenames. Preserve the original basename when staging files.
- Uploading staged digital files produced Etsy upload errors in one run; original download file paths worked reliably.
- Several Excel tags can exceed Etsy's 20-character tag limit. Shorten before submitting.

Working tag normalization for `1A_003`:

- `Watercolor Floral Pattern` -> `Watercolor Floral`
- `Wildflower Fabric Pattern` -> `Wildflower Fabric`
- `Soft Watercolor Design` -> `Soft Watercolor`
- `Handmade Craft Pattern` -> `Handmade Craft`
- `Greenery Floral Print` -> `Greenery Floral`

Observed stable field IDs/names on the create/edit page:

- Title textarea: `#listing-title-input`, name `title`
- Description textarea: `#listing-description-textarea`, name `description`
- Tag input: `#listing-tags-input`
- Price input: `#listing-price-input`, name `variations.configuration.price`
- Quantity input: `#listing-quantity-input`, name `quantity`
- SKU input: `#listing-sku-input`, name `sku`
- Shop section select: `#shop-section-select`
- Listing type radios name: `listing_type_options_group`
  - `physical`
  - `download`
- `When was it made?` select: `#when-made-select`

## Final Page Target State

After a listing is filled and files are uploaded, the Etsy edit page should look roughly like this:

1. Top status area
   - Listing status can show `Active` after publishing or editing an existing listing.
   - Top actions include `View on Etsy` and `Copy`.
   - Bottom-right actions include `Preview` and `Publish changes`.
   - For automation tests, stop before clicking `Publish changes` unless explicitly approved.

2. `Photo and video`
   - Photos are uploaded and visible as thumbnails.
   - Etsy can show a warning such as `Add up to 20 photos and 2 videos`.
   - There are buttons/cards such as `Add video` and `Add photos`.
   - A generated/selected thumbnail appears under `Thumbnails`.

3. `Category`
   - Selected category in the observed page:
     - `Patterns & Blueprints`
     - `Digital files`
   - There is a `Change` button.

4. `Item details`
   - `Title *` is filled from `product.title`.
   - `Digital files *` shows uploaded files.
     - Observed example:
       - `1A_002_seamless.jpg`
       - `1A_002_single.jpg`
   - There is an `Add file` button for digital downloads.
   - Etsy shows a digital-file note to buyers.
   - `Description *` is filled from `product.description`.

   Observed stable field IDs:

   - Title: `#listing-title-input`
   - Description: `#listing-description-textarea`
   - Digital download button text: `Add file`

5. `Item options`
   - Variations are unavailable for digital items.
   - Custom options section can remain unused unless needed.

6. `Attributes`
   - `Tags` should be filled, up to 13.
   - Observed tag count reached `All 13 used`.
   - `Craft type *` should show `All 5 selected`.
   - `Occasion` and `Holiday` can remain empty unless needed.

   Observed final tag values:

   - `Pomegranate Pattern`
   - `Seamless Pattern`
   - `Digital Paper`
   - `Fabric Pattern`
   - `Scrapbook Paper`
   - `Watercolor Floral`
   - `Botanical Pattern`
   - `Cottagecore Print`
   - `Sublimation Design`
   - `Card Making`
   - `Wrapping Paper`
   - `Fruit Pattern`
   - `Kitchen Crafts`

7. `Price and inventory`
   - `Price *` is filled.
   - Observed example: `$ 5.00`
   - `Quantity *` is filled.
   - Observed example: `999`
   - `SKU` is filled.
   - Observed example: `1A_002`

   Observed stable field IDs:

   - Price: `#listing-price-input`
   - Quantity: `#listing-quantity-input`
   - SKU: `#listing-sku-input`

8. `Shipping, processing, and returns`
   - Digital item notice should show that buyers will download files immediately after purchase.

9. `GPSR manufacturer and safety information`
   - Can remain empty unless required.

10. `How it's made`
    - Observed selections:
      - `Who made it?`: `I did`
      - `What is it?`: `A supply or tool to make things`
    - `How is this digital content created?`: `With an AI generator`
    - `Production partners for this listing` can remain empty unless needed.

    Observed radio groups:

    - `whoMade`: choose `I did`
    - `isSupply`: choose `A supply or tool to make things`
    - `whatContent`: choose value `ai_gen`

11. `Settings`
    - `Shop section` should be selected.
    - Observed example: `Flower_and_Waterpaint`
    - `Feature this listing` can remain off.
    - Renewal option observed as automatic.

    Observed stable field:

    - Shop section: `#shop-section-select`

## Craft Type Step

The Etsy form includes a required `Craft type` multi-select field.

Observed state:

- Label: `Craft type *`
- Search input accepts typed filtering, for example `p`.
- The field can have multiple selected options.
- Screenshot showed `All 5 selected`.

Confirmed options to select:

- `Drawing & drafting`
- `Painting`
- `Paper stamping`
- `Party & gifting`
- `Printing & printmaking`

Plugin behavior target:

1. Scroll to the `Craft type *` field if needed.
2. Open the dropdown.
3. Type a search keyword if the full list is not visible.
4. For each configured craft type, find the option by visible text.
5. Click only options that are not already checked.
6. Verify the selected count reaches the expected value, such as `All 5 selected`.
7. Close the dropdown by clicking outside or moving to the next field.

Implementation note:

- Treat this as a multi-select control, not a native `<select>`.
- Prefer visible option text for matching.
- Avoid clearing already selected valid options.
- Store selected craft types as configurable defaults later, rather than hardcoding permanently.

## Open Questions

- Exact Etsy listing creation URL for this shop.
- Exact button text for adding a listing in the current Etsy UI.
- The fifth craft type selected in the screenshot.
- Whether craft types are always the same for all SKU batches.
- Whether the listing should stop at draft save or continue to publish during tests.
