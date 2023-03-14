import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NFTCategory } from '@dcl/schemas'
import { t } from 'decentraland-dapps/dist/modules/translation/utils'
import {
  Atlas as AtlasComponent,
  AtlasTile,
  Color,
  Layer
} from 'decentraland-ui'
import { locations } from '../../modules/routing/locations'
import { isErrorWithMessage } from '../../lib/error'
import { nftAPI } from '../../modules/vendor/decentraland/nft/api'
import { Props, Tile } from './Atlas.types'
import { VendorName } from '../../modules/vendor'
import { NFT } from '../../modules/nft/types'
import Popup from './Popup'
import './Atlas.css'

const getCoords = (x: number | string, y: number | string) => `${x},${y}`

const Atlas: React.FC<Props> = (props: Props) => {
  const {
    tiles,
    onNavigate,
    isEstate,
    withNavigation,
    nfts,
    nftsOnRent,
    withPopup,
    showOnSale,
    tilesByEstateId,
    getContract
  } = props

  const [showPopup, setShowPopup] = useState(false)
  const [hoveredTile, setHoveredTile] = useState<Tile | null>(null)
  const [mouseX, setMouseX] = useState(-1)
  const [mouseY, setMouseY] = useState(-1)
  const [x, setX] = useState(0)
  const [y, setY] = useState(0)
  const timeout = useRef<NodeJS.Timer | null>(null)

  const selection = useMemo(
    () =>
      (props.selection || []).reduce(
        (set, pair) => set.add(getCoords(pair.x, pair.y)),
        new Set<string>()
      ),
    [props.selection]
  )

  const setLand = useCallback(
    (lands, nft, color = Color.SUMMER_RED) => {
      if (nft.vendor === VendorName.DECENTRALAND) {
        switch (nft.category) {
          case NFTCategory.PARCEL: {
            const parcel = (nft as NFT<VendorName.DECENTRALAND>).data.parcel!
            lands.set(getCoords(parcel.x, parcel.y), {
              color
            })
            break
          }
          case NFTCategory.ESTATE: {
            const estateId = nft.tokenId
            if (estateId in tilesByEstateId) {
              for (const tile of tilesByEstateId[estateId]) {
                lands.set(getCoords(tile.x, tile.y), {
                  color,
                  top: !!tile.top,
                  left: !!tile.left,
                  topLeft: !!tile.topLeft
                })
              }
            }
          }
        }
      }
      return lands
    },
    [tilesByEstateId]
  )

  const userTiles = useMemo(
    () =>
      nfts.reduce(
        (lands, nft) => setLand(lands, nft),
        new Map<string, ReturnType<Layer>>()
      ),
    [nfts, setLand]
  )

  const userRentedTiles = useMemo(
    () =>
      nftsOnRent
        .map(([nft]) => nft)
        .reduce(
          (lands, nft) => setLand(lands, nft, Color.SUNISH),
          new Map<string, ReturnType<Layer>>()
        ),
    [nftsOnRent, setLand]
  )

  const isSelected = useCallback(
    (x: number, y: number) => {
      if (selection.has(getCoords(x, y))) return true
      // This is a workaround to paint the large estates, because GraphQL can return only up to 1000 results
      // and some Estates have more parcels than thats
      if (!tiles) return false
      const id = selection.values().next().value as string
      const center = tiles[id] as Tile
      const tile = tiles[getCoords(x, y)] as Tile
      if (
        center &&
        tile &&
        center.estate_id &&
        tile.estate_id &&
        center.estate_id === tile.estate_id &&
        isEstate
      ) {
        return true
      }
      return false
    },
    [selection, tiles, isEstate]
  )

  const forSaleLayer: Layer = useCallback(
    (x, y) => {
      const key = getCoords(x, y)
      const tile = tiles[key] as AtlasTile & { price?: string }
      if (tile && 'price' in tile) {
        return {
          color: '#00d3ff',
          left: !!tile.left,
          top: !!tile.top,
          topLeft: !!tile.topLeft
        }
      }
      return null
    },
    [tiles]
  )

  const selectedStrokeLayer: Layer = useCallback(
    (x, y) => {
      return isSelected(x, y) ? { color: '#ff0044', scale: 1.4 } : null
    },
    [isSelected]
  )

  const selectedFillLayer: Layer = useCallback(
    (x, y) => {
      return isSelected(x, y) ? { color: '#ff9990', scale: 1.2 } : null
    },
    [isSelected]
  )

  const allUserTiles = useMemo(
    () => new Map([...userTiles].concat([...userRentedTiles])),
    [userRentedTiles, userTiles]
  )

  const userLayer: Layer = useCallback(
    (x, y) => allUserTiles.get(getCoords(x, y)) || null,
    [allUserTiles]
  )

  const handleClick = useCallback(
    async (x: number, y: number) => {
      if (!withNavigation) {
        return
      }
      const tile = tiles[getCoords(x, y)] as Tile
      if (!tile) {
        return
      }

      if (tile.estate_id) {
        const estates = getContract({
          category: NFTCategory.ESTATE
        })
        estates && onNavigate(locations.nft(estates.address, tile.estate_id))
      } else {
        try {
          const land = getContract({
            category: NFTCategory.PARCEL
          })
          const tokenId = await nftAPI.fetchTokenId(tile.x, tile.y)
          land && onNavigate(locations.nft(land.address, tokenId))
        } catch (error) {
          const errorMessage = isErrorWithMessage(error)
            ? error.message
            : t('global.unknown_error')
          console.warn(
            `Couldn't fetch parcel ${tile.x},${tile.y}: ${errorMessage}`
          )
        }
      }
    },
    [withNavigation, tiles, getContract, onNavigate]
  )

  const handleHover = useCallback(
    (x: number, y: number) => {
      if (!withPopup) return
      if (selection.has(getCoords(x, y))) {
        setShowPopup(false)
        return
      }
      const id = getCoords(x, y)
      const tile = tiles[id]
      const tileRent = tile
        ? nftsOnRent.find(([nft]) =>
            nft.data.parcel
              ? Number(nft.data.parcel.x) === tile.x &&
                Number(nft.data.parcel.y) === tile.y
              : null
          )
        : null

      if (tile && tileRent && tileRent[1].lessor) {
        tile.owner = tileRent[1].lessor
      }

      if (tile && !showPopup) {
        setShowPopup(true)
        setHoveredTile(tile)
        setMouseX(-1)
        setMouseY(-1)
      } else if (tile && tile !== hoveredTile) {
        setHoveredTile(tile)
        setMouseX(-1)
        setMouseY(-1)
      } else if (!tile && showPopup) {
        setShowPopup(false)
      }
    },
    [withPopup, selection, tiles, showPopup, hoveredTile, nftsOnRent]
  )

  const handleHidePopup = useCallback(() => {
    setShowPopup(false)
    setMouseX(-1)
    setMouseY(-1)
  }, [])

  // fade effect
  useEffect(() => {
    if (!showPopup) {
      timeout.current = setTimeout(() => setHoveredTile(null), 250)
    } else if (timeout.current) {
      clearTimeout(timeout.current)
      timeout.current = null
    }
  }, [showPopup])

  // mouse move
  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      if (showPopup && mouseX === -1 && mouseY === -1) {
        setMouseX(event.offsetX)
        setMouseY(event.offsetY)
        setX(event.offsetX)
        setY(event.offsetY)
      }
    }
    if (withPopup) {
      document.addEventListener('mousemove', handleMouseMove)
    }
    return () => {
      if (withPopup) {
        document.removeEventListener('mousemove', handleMouseMove)
      }
    }
  }, [withPopup, showPopup, mouseX, mouseY])

  // layers
  const layers = [
    userLayer,
    ...(props.layers || []),
    selectedStrokeLayer,
    selectedFillLayer
  ]

  if (showOnSale) {
    layers.unshift(forSaleLayer)
  }

  return (
    <div className="atlas-wrapper" onMouseLeave={handleHidePopup}>
      <AtlasComponent
        {...props}
        tiles={tiles}
        onClick={handleClick}
        onHover={handleHover}
        layers={layers}
      />
      {hoveredTile ? (
        <Popup
          x={x}
          y={y}
          visible={showPopup}
          tile={hoveredTile}
          position={x > window.innerWidth - 280 ? 'left' : 'right'}
        />
      ) : null}
    </div>
  )
}

Atlas.defaultProps = {
  showOnSale: true
}

export default Atlas